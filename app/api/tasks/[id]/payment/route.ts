import { NextResponse } from "next/server";
import { supabase } from "@/lib/x402";

/**
 * The payment trace for a task — what actually happened to the money.
 *
 * TaskMesh's whole economic argument is Gateway BATCHING: a two-cent task is
 * only viable because nobody pays gas per payment. That claim has been invisible
 * — the board just said "paid" and you had to believe us.
 *
 * This exposes the real lifecycle. Circle's Gateway keeps a record per
 * settlement, keyed by the UUID that `settle()` hands back (stored as
 * `payment_events.gateway_tx`). Fetching it tells us whether the payment is
 * still queued in a batch or has landed on-chain — and once it lands, the hash
 * of the ONE transaction that settled it along with everyone else's.
 *
 * Note what this proves when the numbers are read side by side: the requester's
 * authorization is signed instantly and off-chain, and the batch tx lands
 * minutes later. The worker was paid at the first moment; the chain caught up
 * afterwards. That gap IS the product.
 */

// Circle's settlement lookup. Public — no API key needed (the settlement UUID is
// the capability). Not exposed by @circle-fin/x402-batching, which only wraps
// verify/settle/supported, so we call it directly.
const GATEWAY_API = "https://gateway-api-testnet.circle.com";

interface CircleTransfer {
  id: string;
  status: string;
  amount: string;
  toAddress: string;
  fromAddress: string;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // The task's OWN settlement (requester → worker). Filter by endpoint, not just
  // raw.task_id: a two-hop task also has a worker → service payment carrying the
  // same task_id, and matching both would break maybeSingle(). The result route
  // is the requester → worker leg, uniquely.
  const { data: event, error } = await supabase
    .from("payment_events")
    .select("gateway_tx,amount_usdc,payer,created_at")
    .eq("endpoint", `/api/tasks/${id}/result`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!event?.gateway_tx) {
    return NextResponse.json({ error: "No payment for this task" }, { status: 404 });
  }

  // Ask Circle where the money actually is. A failure here is not fatal — the
  // payment happened regardless; we just can't show the on-chain half yet.
  let transfer: CircleTransfer | null = null;
  try {
    const res = await fetch(`${GATEWAY_API}/v1/x402/transfers/${event.gateway_tx}`, {
      cache: "no-store",
    });
    if (res.ok) transfer = (await res.json()) as CircleTransfer;
  } catch (err) {
    console.error("[taskmesh] settlement lookup failed:", err);
  }

  const settled = transfer?.status === "completed";

  return NextResponse.json({
    settlement_id: event.gateway_tx,
    amount_usdc: event.amount_usdc,
    payer: event.payer,
    // "pending" until Circle's relayer flushes the batch on-chain.
    status: transfer?.status ?? "unknown",
    // The ONE on-chain transaction that settled this payment together with every
    // other payment in its batch. This is the number the whole design rests on.
    batch_tx: transfer?.txHash ?? null,
    authorized_at: transfer?.createdAt ?? event.created_at,
    settled_at: settled ? transfer?.updatedAt ?? null : null,
  });
}
