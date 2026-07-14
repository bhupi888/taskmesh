import Anthropic from "@anthropic-ai/sdk";

/**
 * The two places TaskMesh needs a model.
 *
 *   summarize() — the worker agent actually doing the job.
 *   validate()  — the platform checking the work before it becomes payable.
 *
 * The validator is the answer to our one honest weakness: without it, a worker
 * could submit garbage and still be paid, because the requester pays to
 * *unlock* a result rather than to approve it.
 *
 * Arc's own arc-escrow sample solves the same problem with an AI validator — but
 * then needs an on-chain escrow contract per job to enforce the verdict. We
 * don't. If the work fails validation, we simply never open the paywall. Same
 * protection, zero gas, viable at two cents.
 */

const MODEL = "claude-opus-4-8";

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — add it to .env.local. " +
          "Without it the worker falls back to a stub summarizer and validation is skipped.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function firstText(content: Anthropic.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

/** The worker agent doing the actual job. */
export async function summarize(prompt: string): Promise<string> {
  const text = prompt.replace(/^Summarize:\s*/i, "").trim();

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system:
      "You summarize support tickets for a triage queue. Two sentences maximum. " +
      "State the problem and the most likely cause. No preamble, no restating the question.",
    messages: [{ role: "user", content: text }],
  });

  const summary = firstText(response.content).trim();
  if (!summary) throw new Error("Model returned no summary");
  return summary;
}

/** One acceptance criterion and whether the submitted work met it. */
export interface CriterionResult {
  criterion: string;
  met: boolean;
  reasoning: string;
}

export interface Verdict {
  pass: boolean;
  reason: string;
  /** Per-criterion breakdown — what the board renders as a checklist. */
  criteria: CriterionResult[];
}

/**
 * Derive the acceptance criteria a good summary of this ticket must satisfy.
 *
 * Called at post time so the criteria can be shown to a worker the moment it
 * claims the task ("here's what you're judged against"), and graded against at
 * submission time. Kept to a few short, checkable phrases.
 */
export async function deriveCriteria(prompt: string): Promise<string[]> {
  const source = prompt.replace(/^Summarize:\s*/i, "").trim();

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You define acceptance criteria for a BRIEF triage summary of a support " +
      "ticket. The summary is at most two sentences and states the core problem " +
      "and its most likely cause — it deliberately omits peripheral context.\n\n" +
      "Fill exactly the three slots in the schema. Each is one short imperative " +
      "phrase, judgeable as met or not-met.\n\n" +
      "NEVER demand a peripheral detail that a two-sentence summary would " +
      "reasonably leave out — deadlines, dates, names, ticket IDs, order numbers, " +
      "counts, or exhaustive specifics. A criterion is only legitimate if a good " +
      "two-sentence summary would fail without it. A clearly-hedged \"most likely " +
      "cause\" is expected and counts as faithful, not invented. Do not summarize " +
      "the ticket yourself.",
    messages: [{ role: "user", content: `SOURCE TICKET:\n${source}` }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          // Three FIXED slots, not a free array.
          //
          // A free `string[]` let the model bolt on extra criteria demanding
          // peripheral facts ("Mentions the deadline of the finance team closing
          // the quarter") — which a correct two-sentence summary omits by design,
          // so the validator then failed good work. Prompting against it was not
          // reliable: two tickets posted two minutes apart got 3 clean criteria
          // and 4 poisoned ones. Fixed slots make the bad shape unrepresentable.
          //
          // Do not "simplify" this back to an array of strings.
          type: "object",
          properties: {
            core_problem: {
              type: "string",
              description:
                "Criterion: the summary states the core problem of the ticket.",
            },
            key_detail: {
              type: "string",
              description:
                "Criterion: the summary captures the single distinguishing detail " +
                "that matters for DIAGNOSIS (what narrows the cause) — never a " +
                "deadline, date, name, or ID.",
            },
            faithfulness: {
              type: "string",
              description:
                "Criterion: the summary does not contradict the source or invent " +
                "facts; a hedged likely cause is acceptable.",
            },
          },
          required: ["core_problem", "key_detail", "faithfulness"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = firstText(response.content);
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return [p.core_problem, p.key_detail, p.faithfulness]
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The platform grading the work before it can be sold, criterion by criterion.
 *
 * A worker that fails this never reaches the paywall, so bad work is never
 * payable. Deliberately strict about the failure that actually matters: a
 * summary that is *unfaithful* to the source — inventing facts, contradicting
 * it, or not summarizing it at all. `pass` is true only if EVERY criterion is
 * met.
 *
 * The per-criterion `reasoning` is shown on the public board, so the model is
 * told never to reproduce the summary itself there — the result stays behind
 * the paywall; only the verdict is public.
 */
export async function validate(
  prompt: string,
  result: string,
  criteria: string[],
): Promise<Verdict> {
  const source = prompt.replace(/^Summarize:\s*/i, "").trim();

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 700,
    thinking: { type: "adaptive" },
    system:
      "You grade a submitted summary against explicit acceptance criteria.\n\n" +
      "The summary is a BRIEF triage summary — two sentences, stating the core " +
      "problem and its most likely cause. Grade with that in mind:\n" +
      "- A clearly-hedged \"most likely cause\" is expected; do NOT mark it an " +
      "invented fact.\n" +
      "- Omitting peripheral context (deadlines, names, exact figures) is fine " +
      "and must NOT fail a criterion.\n" +
      "- Judge faithfulness and effort, not style — terse, imperfect phrasing is " +
      "fine.\n\n" +
      "For EACH criterion, decide whether the summary meets it (met: true/false) " +
      "and give a ONE-SENTENCE reasoning. Fail a criterion only when the summary " +
      "genuinely violates it — contradicts the source, invents a specific fact " +
      "presented as certain, summarizes the wrong thing, or is empty filler.\n\n" +
      "CRITICAL: your reasoning strings are shown publicly while the summary " +
      "itself stays behind a paywall — never quote or reproduce the summary's " +
      "content in a reasoning string. Describe only whether the requirement is " +
      "satisfied.",
    messages: [
      {
        role: "user",
        content:
          `SOURCE:\n${source}\n\n` +
          `ACCEPTANCE CRITERIA:\n${criteria
            .map((c, i) => `${i + 1}. ${c}`)
            .join("\n")}\n\n` +
          `SUBMITTED SUMMARY:\n${result}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            criteria: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criterion: { type: "string" },
                  met: { type: "boolean" },
                  reasoning: {
                    type: "string",
                    description:
                      "One sentence; must not reproduce the summary text.",
                  },
                },
                required: ["criterion", "met", "reasoning"],
                additionalProperties: false,
              },
            },
          },
          required: ["criteria"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = firstText(response.content);
  try {
    const parsed = JSON.parse(raw) as { criteria?: unknown };
    const graded: CriterionResult[] = Array.isArray(parsed.criteria)
      ? parsed.criteria.map((c) => {
          const o = c as Record<string, unknown>;
          return {
            criterion: String(o.criterion ?? ""),
            met: Boolean(o.met),
            reasoning: String(o.reasoning ?? ""),
          };
        })
      : [];

    // Pass only if the model actually graded something and every item is met.
    const pass = graded.length > 0 && graded.every((c) => c.met);
    const reason = pass
      ? "All acceptance criteria met."
      : graded.find((c) => !c.met)?.reasoning ??
        "One or more acceptance criteria were not met.";

    return { pass, reason, criteria: graded };
  } catch {
    // A validator we can't read is not a reason to pay for unchecked work.
    return {
      pass: false,
      reason: "Validator returned unreadable output",
      criteria: [],
    };
  }
}
