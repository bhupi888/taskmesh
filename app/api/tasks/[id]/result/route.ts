import { NextRequest, NextResponse } from "next/server";
import {
  buildPaymentRequirements,
  facilitator,
  supabase,
} from "@/lib/x402";

/**
 * The paywall — and the whole point of TaskMesh.
 *
 * The finished work IS the paid resource. A worker's result sits here behind a
 * 402 until the requester pays for it. On payment, the bounty settles to the
 * WORKER's wallet, not to a platform seller.
 *
 * Circle's demo fixes payTo to a single SELLER_ADDRESS at module load. Here the
 * price and the payee are both properties of the task, resolved per request —
 * which is what turns a single-seller shop into a marketplace.
 */

interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepted?: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const endpoint = `/api/tasks/${id}/result`;

  const { data: task, error: loadError } = await supabase
    .from("tasks")
    .select("id,status,bounty_usdc,worker_address,requester_address")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  }

  // Nothing to sell yet — the work isn't done.
  if (task.status !== "submitted" && task.status !== "paid") {
    return NextResponse.json(
      { error: `Task is ${task.status} — no result to buy yet` },
      { status: 409 },
    );
  }

  // The goods live in task_results, not on the public board — see the
  // 20260714 migration. Fetch them with the service-role client only.
  async function loadResult(): Promise<string | null> {
    const { data } = await supabase
      .from("task_results")
      .select("result")
      .eq("task_id", id)
      .maybeSingle();
    return data?.result ?? null;
  }

  // Already bought. Don't charge twice for the same result.
  if (task.status === "paid") {
    return NextResponse.json({ id: task.id, result: await loadResult(), paid: true });
  }

  if (!task.worker_address) {
    return NextResponse.json(
      { error: "Task has no worker to pay" },
      { status: 500 },
    );
  }

  // Price and payee both come from the task itself.
  const requirements = buildPaymentRequirements(
    `$${task.bounty_usdc}`,
    task.worker_address as `0x${string}`,
  );

  const paymentSignature = req.headers.get("payment-signature");

  // Unpaid: tell the caller what it costs and who to pay.
  if (!paymentSignature) {
    console.log(
      `[taskmesh] 402 for ${endpoint} — ${task.bounty_usdc} USDC to worker ${task.worker_address}`,
    );

    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: endpoint,
        description: `Completed task result (${task.bounty_usdc} USDC)`,
        mimeType: "application/json",
      },
      accepts: [requirements],
    };

    return new NextResponse(JSON.stringify({}), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": Buffer.from(
          JSON.stringify(paymentRequired),
        ).toString("base64"),
      },
    });
  }

  try {
    const paymentPayload: PaymentPayload = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf-8"),
    );

    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      return NextResponse.json(
        {
          error: "Payment verification failed",
          reason: verifyResult.invalidReason,
        },
        { status: 402 },
      );
    }

    const settleResult = await facilitator.settle(paymentPayload, requirements);
    if (!settleResult.success) {
      console.error(
        `[taskmesh] settlement failed for ${endpoint}: ${settleResult.errorReason}`,
      );
      return NextResponse.json(
        {
          error: "Payment settlement failed",
          reason: settleResult.errorReason,
        },
        { status: 402 },
      );
    }

    const payer = settleResult.payer ?? verifyResult.payer ?? "unknown";

    // Release the goods and close the task out. Guarded on `submitted` so a
    // double-spend race can't pay the worker twice for one task.
    const { data: paidTask, error: payError } = await supabase
      .from("tasks")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();

    if (payError || !paidTask) {
      console.error(
        `[taskmesh] paid but failed to mark task ${id}:`,
        payError?.message ?? "already settled by a concurrent request",
      );
    }

    // Same ledger the seller dashboard already reads.
    const { error: eventError } = await supabase.from("payment_events").insert({
      endpoint,
      payer,
      amount_usdc: task.bounty_usdc,
      network: requirements.network,
      gateway_tx: settleResult.transaction ?? null,
      raw: { requirements, settleResult, task_id: id },
    });
    if (eventError) {
      console.error("Failed to record payment event:", eventError.message);
    }

    console.log(
      `[taskmesh] PAID ${task.bounty_usdc} USDC — requester ${payer} -> worker ${task.worker_address} (task ${id})`,
    );

    const response = NextResponse.json({
      id: task.id,
      result: await loadResult(),
      paid_to: task.worker_address,
      amount_usdc: task.bounty_usdc,
    });

    response.headers.set(
      "PAYMENT-RESPONSE",
      Buffer.from(
        JSON.stringify({
          success: true,
          transaction: settleResult.transaction,
          network: requirements.network,
          payer,
        }),
      ).toString("base64"),
    );

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[taskmesh] payment processing error:", message);
    return NextResponse.json(
      { error: "Payment processing error", message },
      { status: 500 },
    );
  }
}
