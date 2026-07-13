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

export interface Verdict {
  pass: boolean;
  reason: string;
}

/**
 * The platform grading the work before it can be sold.
 *
 * A worker that fails this never reaches the paywall, so bad work is never
 * payable. Deliberately strict about the failure that actually matters: a
 * summary that is *unfaithful* to the source — inventing facts, contradicting
 * it, or not summarizing it at all.
 */
export async function validate(
  prompt: string,
  result: string,
): Promise<Verdict> {
  const source = prompt.replace(/^Summarize:\s*/i, "").trim();

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 512,
    thinking: { type: "adaptive" },
    system:
      "You are grading whether a submitted summary is acceptable work.\n\n" +
      "PASS if it is a faithful, relevant summary of the source: it captures the " +
      "actual problem and invents nothing that isn't supported by the source.\n\n" +
      "FAIL if it is unfaithful or not real work: it contradicts the source, " +
      "invents facts, summarizes something else, is empty or nonsense, or is " +
      "filler that conveys nothing about the source.\n\n" +
      "Judge faithfulness and effort, not style. Terse is fine. Imperfect phrasing " +
      "is fine. Do not fail work merely for being brief or inelegant.",
    messages: [
      {
        role: "user",
        content: `SOURCE:\n${source}\n\nSUBMITTED SUMMARY:\n${result}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            pass: {
              type: "boolean",
              description: "true if the summary is acceptable work",
            },
            reason: {
              type: "string",
              description: "One sentence explaining the verdict.",
            },
          },
          required: ["pass", "reason"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = firstText(response.content);
  try {
    const parsed = JSON.parse(raw) as Verdict;
    return { pass: Boolean(parsed.pass), reason: String(parsed.reason ?? "") };
  } catch {
    // A validator we can't read is not a reason to pay for unchecked work.
    return { pass: false, reason: "Validator returned unreadable output" };
  }
}
