import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { supabase } from "@/lib/x402";
import { llmConfigured, validate } from "@/lib/llm";

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
    .select("id,prompt,bounty_usdc,worker_address,status")
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

  // Grade the work before it can be sold.
  if (llmConfigured()) {
    const verdict = await validate(task.prompt, parsed.data.result);

    if (!verdict.pass) {
      // Rejected. Put the task back on the board and discard the result — it
      // never becomes purchasable, so nobody pays for it.
      const { error: rejectError } = await supabase
        .from("tasks")
        .update({
          status: "open",
          worker_address: null,
          claimed_at: null,
          result: null,
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

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "submitted",
      result: parsed.data.result,
      submitted_at: new Date().toISOString(),
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
    `[taskmesh] submitted ${id.slice(0, 8)} — awaiting payment of ${data.bounty_usdc} USDC to ${data.worker_address}`,
  );
  return NextResponse.json(data);
}
