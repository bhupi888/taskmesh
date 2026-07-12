import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { supabase } from "@/lib/x402";

/**
 * A worker agent submits its finished work.
 *
 * The result is stored but NOT returned to anyone yet — it stays behind the
 * paywall at /api/tasks/[id]/result until the requester pays for it.
 *
 * Only the worker that claimed the task may submit to it (the `worker_address`
 * match below), otherwise anyone could overwrite someone else's work and
 * collect their bounty.
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
    `[taskmesh] submitted ${id} — awaiting payment of ${data.bounty_usdc} USDC to ${data.worker_address}`,
  );
  return NextResponse.json(data);
}
