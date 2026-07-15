import { NextRequest, NextResponse } from "next/server";
import { buildPaymentRequirements, facilitator, supabase, sellerAddress } from "@/lib/x402";
import { triageAnalysis } from "@/lib/llm";

/**
 * A specialist x402 service — the SECOND agent in an agent-to-agent-to-agent job.
 *
 * A worker fulfilling a ticket is good at summarizing, but severity/routing is a
 * different skill. So mid-task it pays THIS service to do that part, folds the
 * answer into its work, and carries on. Two real x402 settlements for one job:
 * requester → worker, and worker → this service.
 *
 * This is the same primitive as the task paywall (`/api/tasks/:id/result`),
 * pointed inward. It's paywalled the same way, settles the same way, and records
 * to the same ledger — the only differences are the payee (a distinct service
 * wallet, not the task's worker) and that the buyer is another agent, not a human.
 *
 * The service earns to SELLER_ADDRESS — a real wallet, distinct from any worker,
 * so the two-hop is visibly a payment between two different parties.
 */

const PRICE = "0.005";

interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepted?: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const endpoint = "/api/services/triage";

  // The ticket to analyse rides in the body. We read it up front so the 402 and
  // the paid response are about the same input.
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Provide { text } to triage" }, { status: 400 });
  }

  const requirements = buildPaymentRequirements(`$${PRICE}`, sellerAddress);
  const paymentSignature = req.headers.get("payment-signature");

  // Unpaid — quote the price and the payee.
  if (!paymentSignature) {
    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: endpoint,
        description: `Specialist triage analysis (${PRICE} USDC)`,
        mimeType: "application/json",
      },
      accepts: [requirements],
    };
    return new NextResponse(JSON.stringify({}), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
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
        { error: "Payment verification failed", reason: verifyResult.invalidReason },
        { status: 402 },
      );
    }

    const settleResult = await facilitator.settle(paymentPayload, requirements);
    if (!settleResult.success) {
      return NextResponse.json(
        { error: "Payment settlement failed", reason: settleResult.errorReason },
        { status: 402 },
      );
    }

    const payer = settleResult.payer ?? verifyResult.payer ?? "unknown";

    // Do the specialist work only after the money is real.
    const analysis = await triageAnalysis(text);

    // Same ledger the task payments use — tagged as the worker→service leg so the
    // two-hop can be reconstructed for a task's payment trace.
    const { error: eventError } = await supabase.from("payment_events").insert({
      endpoint,
      payer,
      amount_usdc: PRICE,
      network: requirements.network,
      gateway_tx: settleResult.transaction ?? null,
      raw: {
        leg: "worker->service",
        service: "triage",
        task_id: body && "task_id" in body ? (body as { task_id?: string }).task_id ?? null : null,
        settleResult,
      },
    });
    if (eventError) console.error("[triage] payment event failed:", eventError.message);

    console.log(`[triage] PAID ${PRICE} USDC from ${payer} -> service ${sellerAddress}`);

    const response = NextResponse.json({ analysis, amount_usdc: PRICE, paid_to: sellerAddress });
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
    console.error("[triage] processing error:", message);
    return NextResponse.json({ error: "Service error", message }, { status: 500 });
  }
}
