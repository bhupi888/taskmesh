import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { TriageAnalysis } from "@/lib/llm";

/**
 * The spending side of a worker — what lets an agent PAY for a sub-service, not
 * just receive.
 *
 * WHY THIS IS A SEPARATE WALLET, AND NOT THE WORKER'S CIRCLE WALLET: this is our
 * documented composition finding made concrete. A worker's earnings land in a
 * Circle developer-controlled (MPC) wallet, which never exposes a private key.
 * Circle's Gateway client demands a raw key to sign payment authorizations. So a
 * worker literally cannot spend from the wallet it earns into. To spend, an
 * agent needs a distinct raw-key wallet. That's not a hack — it's the honest
 * shape of the current SDK.
 *
 * FUNDING, HONESTLY: on this testnet demo the spend wallet falls back to the
 * platform's existing funder (`BUYER_PRIVATE_KEY`) if `WORKER_SPEND_PRIVATE_KEY`
 * isn't set — so the two-hop is real without needing a freshly funded wallet.
 * In production a worker holds and funds its own spend wallet. Set
 * `WORKER_SPEND_PRIVATE_KEY` to demo that separation.
 *
 * If NEITHER key is present, spending is simply OFF and the worker does the
 * plain job. Nothing here is ever faked.
 */

const LOW_WATER = BigInt(100_000); // 0.1 USDC atomic
const DEPOSIT_AMOUNT = "0.5";

function spendKey(): `0x${string}` | null {
  return (
    (process.env.WORKER_SPEND_PRIVATE_KEY as `0x${string}` | undefined) ??
    (process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined) ??
    null
  );
}

/** Is the worker able to spend at all? If not, the sub-service is skipped. */
export function spendingEnabled(): boolean {
  return spendKey() !== null;
}

let gateway: GatewayClient | null = null;
function client(): GatewayClient {
  if (!gateway) {
    const key = spendKey();
    if (!key) throw new Error("No spend key configured");
    gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
  }
  return gateway;
}

async function ensureFunded(): Promise<void> {
  const balances = await client().getBalances();
  if (balances.gateway.available >= LOW_WATER) return;
  await client().deposit(DEPOSIT_AMOUNT);
  for (let i = 0; i < 30; i++) {
    const updated = await client().getBalances();
    if (updated.gateway.available > BigInt(0)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Spend wallet deposit never became spendable");
}

export interface TriagePurchase {
  analysis: TriageAnalysis;
  amount_usdc: string;
  paid_to: string;
  tx: string | null;
}

/**
 * Pay the triage service for a ticket and get its analysis back.
 *
 * This is a genuine x402 buy: the client GETs the 402, signs a USDC
 * authorization offchain, retries, and Gateway settles it — the same dance the
 * requester does to pay the worker, one level down.
 *
 * Best-effort: if it fails (unfunded, service down), the worker just skips the
 * upgrade and submits its plain summary. The sub-service is an enhancement, not
 * a dependency the core loop can be broken by.
 */
export async function buyTriage(
  origin: string,
  text: string,
  taskId: string,
): Promise<TriagePurchase | null> {
  if (!spendingEnabled()) return null;
  try {
    await ensureFunded();
    const { data, formattedAmount } = await client().pay<{
      analysis: TriageAnalysis;
      paid_to: string;
    }>(`${origin}/api/services/triage`, {
      method: "POST",
      body: { text, task_id: taskId },
    });
    return {
      analysis: data.analysis,
      amount_usdc: formattedAmount,
      paid_to: data.paid_to,
      tx: null,
    };
  } catch (err) {
    console.error("[worker-spend] triage buy failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
