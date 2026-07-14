import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { supabase } from "@/lib/x402";
import { deriveCriteria, llmConfigured, validate } from "@/lib/llm";
import { settleTask } from "@/lib/payer";
import type { CriterionResult } from "@/lib/llm";

// Settlement happens after the response is sent, and can involve an on-chain
// Gateway deposit when the payer runs low.
export const maxDuration = 60;

/**
 * A worker agent submits its finished work — and the platform grades it.
 *
 * The result is stored but NOT returned to anyone yet — it stays behind the
 * paywall at /api/tasks/[id]/result until the requester pays for it.
 *
 * Only the worker that claimed the task may submit to it (the `worker_address`
 * match below), otherwise anyone could overwrite someone else's work and
 * collect their bounty.
 *
 * VALIDATION IS THE GATE. Because the requester pays to *unlock* a result
 * rather than to approve it, an ungraded submission would mean a worker could
 * hand in garbage and still get paid. So the work is graded here, before it is
 * ever purchasable: work that fails goes back on the board and is never payable.
 *
 * Arc's arc-escrow sample validates with AI too — and then needs an on-chain
 * escrow contract per job to enforce the verdict. We enforce it by simply not
 * opening the paywall. Same protection, zero gas, viable on a two-cent task.
 */

// Must normalise exactly as /claim does. Circle Wallets hands out lowercase
// addresses; getAddress() checksums them. If only one end normalises, the
// worker_address lookup below silently misses and the worker is told the job
// isn't theirs — after they've already done the work.
const Submit = z.object({
  worker_address: z.string().transform((a, ctx) => {
    try {
      return getAddress(a);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Not a valid address" });
      return z.NEVER;
    }
  }),
  result: z.string().min(1).max(50_000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = Submit.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "worker_address and result required" },
      { status: 400 },
    );
  }

  // Load the task first — we need the original prompt to grade the work against,
  // and this also confirms the submitter is the worker who actually claimed it.
  const { data: task, error: loadError } = await supabase
    .from("tasks")
    .select("id,prompt,bounty_usdc,worker_address,status,criteria")
    .eq("id", id)
    .eq("status", "claimed")
    .eq("worker_address", parsed.data.worker_address)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json(
      { error: "Not your claimed task, or it isn't in the claimed state" },
      { status: 409 },
    );
  }

  // The per-criterion verdict to persist on a pass, so the board can render the
  // validated checklist. Stays null when the LLM isn't configured (stub mode).
  let gradedCriteria: CriterionResult[] | null = null;
  // The criteria list actually graded against — usually the one stored at post
  // time, but derived here as a fallback for tasks posted before it existed.
  let criteriaUsed: string[] | null = Array.isArray(task.criteria)
    ? (task.criteria as string[])
    : null;

  // Grade the work before it can be sold.
  if (llmConfigured()) {
    if (!criteriaUsed || criteriaUsed.length === 0) {
      const derived = await deriveCriteria(task.prompt).catch(() => []);
      criteriaUsed = derived.length ? derived : null;
    }

    const verdict = await validate(
      task.prompt,
      parsed.data.result,
      criteriaUsed ?? [],
    );
    gradedCriteria = verdict.criteria;

    if (!verdict.pass) {
      // Remember WHO failed this task, before putting it back on the board.
      //
      // Without this the task returns to `open` and the same worker can just
      // claim it again, submit garbage again, and burn another LLM validation
      // call — the cost of which lands on us, not on them. /claim reads this row
      // and refuses. The task stays claimable by every OTHER worker.
      //
      // Best-effort: a failure to record this must not turn into a failure to
      // reject bad work. Worst case we fall back to the old behaviour.
      const { error: recordError } = await supabase
        .from("task_rejections")
        .upsert(
          {
            task_id: id,
            worker_address: parsed.data.worker_address,
            reason: verdict.reason,
          },
          { onConflict: "task_id,worker_address" },
        );

      if (recordError) {
        console.error(
          `[taskmesh] could not record rejection for ${id.slice(0, 8)}:`,
          recordError.message,
        );
      }

      // Put the task back on the board — the result was never written to
      // task_results (we only store it after a pass), so nothing to discard.
      const { error: rejectError } = await supabase
        .from("tasks")
        .update({
          status: "open",
          worker_address: null,
          claimed_at: null,
        })
        .eq("id", id)
        .eq("status", "claimed");

      if (rejectError) {
        return NextResponse.json({ error: rejectError.message }, { status: 500 });
      }

      console.log(
        `[taskmesh] REJECTED ${id.slice(0, 8)} — ${verdict.reason} (back on the board, unpaid)`,
      );
      return NextResponse.json(
        { error: "Work rejected by validation", reason: verdict.reason },
        { status: 422 },
      );
    }

    console.log(`[taskmesh] validated ${id.slice(0, 8)} — ${verdict.reason}`);
  }

  // Store the goods in the paywalled table BEFORE flipping status. Once a task
  // is `submitted` its result is purchasable, so the result must already exist
  // by then; doing it in this order means the worst case is an orphan result row
  // on a still-`claimed` task (harmless — it isn't reachable) rather than a
  // `submitted` task with no result behind the paywall.
  const { error: resultError } = await supabase
    .from("task_results")
    .upsert(
      { task_id: id, result: parsed.data.result },
      { onConflict: "task_id" },
    );

  if (resultError) {
    return NextResponse.json({ error: resultError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      // Surface the validation on the board. `criteria` is refreshed too, in
      // case it was derived here as a fallback rather than at post time.
      criteria: criteriaUsed,
      validation: gradedCriteria,
    })
    .eq("id", id)
    .eq("status", "claimed")
    .eq("worker_address", parsed.data.worker_address)
    .select("id,status,bounty_usdc,worker_address,submitted_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Not your claimed task, or it isn't in the claimed state" },
      { status: 409 },
    );
  }

  console.log(
    `[taskmesh] submitted ${id.slice(0, 8)} — settling ${data.bounty_usdc} USDC to ${data.worker_address}`,
  );

  // The work passed. Pay for it — now, automatically, with nobody clicking
  // anything. This is what "no human in the loop" actually means, and until this
  // existed the demo contradicted the pitch.
  //
  // After the response, so the worker isn't left hanging on an on-chain deposit.
  const origin = req.nextUrl.origin;
  after(async () => {
    await settleTask(origin, id);
  });

  return NextResponse.json(data);
}
