import { NextResponse } from "next/server";
import { supabase } from "@/lib/x402";

/**
 * What each worker has actually earned, straight from Circle Gateway.
 *
 * Two numbers matter here, and the difference between them IS the product:
 *
 *   settled       — flushed onchain, spendable
 *   pendingBatch  — earned, but still accumulating in a Gateway batch
 *
 * Gateway doesn't put a 5-cent payment onchain by itself; that would cost more
 * than the payment. It batches. So a freshly-paid worker sits in pendingBatch
 * and moves to settled once the batch flushes. Showing both columns lets you
 * watch nanopayment batching happen.
 *
 * This is a public Gateway endpoint — no key, no signature. We only need the
 * worker's address.
 */

const GATEWAY_BALANCES = "https://gateway-api-testnet.circle.com/v1/balances";
const ARC_TESTNET_DOMAIN = 26;

interface GatewayBalance {
  domain: number;
  depositor: string;
  balance: string;
  pendingBatch: string;
}

export async function GET() {
  const { data: workers, error } = await supabase
    .from("workers")
    .select("name,address,circle_wallet_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!workers?.length) {
    return NextResponse.json({ earnings: [] });
  }

  try {
    const res = await fetch(GATEWAY_BALANCES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        token: "USDC",
        sources: workers.map((w) => ({
          domain: ARC_TESTNET_DOMAIN,
          depositor: w.address,
        })),
      }),
    });

    if (!res.ok) {
      console.error("[taskmesh] Gateway balances failed:", res.status);
      // Still return the workers — the board shouldn't blank out just because
      // Circle's balance API had a bad minute.
      return NextResponse.json({
        earnings: workers.map((w) => ({ ...w, settled: null, pending: null })),
      });
    }

    const data = (await res.json()) as { balances?: GatewayBalance[] };
    const byAddress = new Map(
      (data.balances ?? []).map((b) => [b.depositor.toLowerCase(), b]),
    );

    return NextResponse.json({
      earnings: workers.map((w) => {
        const bal = byAddress.get(w.address.toLowerCase());
        return {
          ...w,
          settled: bal?.balance ?? "0",
          pending: bal?.pendingBatch ?? "0",
        };
      }),
    });
  } catch (err) {
    console.error("[taskmesh] Gateway balances error:", err);
    return NextResponse.json({
      earnings: workers.map((w) => ({ ...w, settled: null, pending: null })),
    });
  }
}
