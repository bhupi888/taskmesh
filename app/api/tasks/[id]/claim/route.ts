import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { supabase } from "@/lib/x402";

/**
 * A worker agent claims an open task.
 *
 * The `.eq("status", "open")` in the UPDATE is the lock: Postgres applies it
 * atomically, so if two workers race for the same task exactly one UPDATE
 * matches a row and the loser gets zero rows back. No transaction needed.
 */

// getAddress() rejects anything that isn't a real EIP-55 address and returns it
// checksummed. This is the gate that matters: a worker whose address can't be
// signed to would do the work and then find its bounty unpayable at settlement.
// Catch it here, at claim time, not after the work is done.
const Claim = z.object({
  worker_address: z
    .string()
    .transform((a, ctx) => {
      try {
        return getAddress(a);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Not a valid address" });
        return z.NEVER;
      }
    }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = Claim.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "worker_address required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "claimed",
      worker_address: parsed.data.worker_address,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id,status,worker_address,prompt,bounty_usdc,kind")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // No row: the task doesn't exist, or another worker got there first.
  if (!data) {
    return NextResponse.json(
      { error: "Task is not open — already claimed, or no such task" },
      { status: 409 },
    );
  }

  console.log(`[taskmesh] claimed ${id} by ${parsed.data.worker_address}`);
  return NextResponse.json(data);
}
