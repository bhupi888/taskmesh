import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/x402";
import { payForResult } from "@/lib/payer";

/**
 * The dashboard's "Pay & unlock" button.
 *
 * Same x402 flow the requester agent uses — it just runs on the server so a
 * human (a judge, in a demo) can trigger it with a click instead of a terminal.
 * The bounty still settles to the WORKER; we're only the wallet holding the
 * float.
 *
 * Deliberately NOT here: claiming and doing the work. That belongs to the worker
 * agent. Putting a "do the task" button in the UI would undercut the whole
 * premise that agents do the work.
 */

// Paying can involve an on-chain Gateway deposit when the payer runs low.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: task, error } = await supabase
    .from("tasks")
    .select("id,status,result,bounty_usdc,worker_address")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  }

  // Already bought — hand back the goods rather than charging twice.
  if (task.status === "paid") {
    return NextResponse.json({
      result: task.result,
      paid_to: task.worker_address,
      amount_usdc: task.bounty_usdc,
      already_paid: true,
    });
  }

  if (task.status !== "submitted") {
    return NextResponse.json(
      { error: `Task is ${task.status} — there's nothing finished to buy yet` },
      { status: 409 },
    );
  }

  // Pay our own paywall. The 402 on that route names the worker as payTo, so
  // this settles to them.
  const origin = req.nextUrl.origin;

  try {
    const paid = await payForResult(`${origin}/api/tasks/${id}/result`);
    console.log(
      `[taskmesh] dashboard paid ${paid.amount_usdc} USDC -> ${paid.paid_to} (task ${id.slice(0, 8)})`,
    );
    return NextResponse.json(paid);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[taskmesh] dashboard payment failed:", message);
    return NextResponse.json(
      { error: "Payment failed", detail: message },
      { status: 502 },
    );
  }
}
