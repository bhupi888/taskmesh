import { GatewayClient } from "@circle-fin/x402-batching/client";

/**
 * The server-side requester wallet — what the dashboard's "Pay & unlock" button
 * spends from.
 *
 * WHY THIS EXISTS: a judge should be able to drive the demo by clicking, not by
 * running `npm run requester`. But a browser can't hold a wallet without a
 * connect-flow, and we don't want one. So TaskMesh pays from a server-managed
 * funder — which is also the honest production shape: a marketplace operator
 * holds a float and settles on the requester's behalf.
 *
 * The agents (`requester.mts`) still spin up their own ephemeral wallets. This
 * is the *human* entry point, not a replacement for the agent path.
 */

const DEPOSIT_AMOUNT = "1";
// 0.2 USDC in atomic units — top up before we run dry mid-demo.
// (BigInt(...) rather than a `n` literal: the app's TS target predates them.)
const LOW_WATER = BigInt(200_000);

let gateway: GatewayClient | null = null;

function client(): GatewayClient {
  if (!gateway) {
    const privateKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!privateKey) {
      throw new Error(
        "BUYER_PRIVATE_KEY is not set — the dashboard's Pay button needs a funded requester wallet.",
      );
    }
    gateway = new GatewayClient({ chain: "arcTestnet", privateKey });
  }
  return gateway;
}

/**
 * Make sure the payer has spendable Gateway balance.
 *
 * A Gateway deposit is an on-chain transaction, so the FIRST payment after the
 * balance runs low is slow (~15s). Everything after it is instant — that's the
 * whole point of batching. Don't "optimise" this away by depositing per payment.
 */
async function ensureFunded(): Promise<void> {
  const balances = await client().getBalances();
  if (balances.gateway.available >= LOW_WATER) return;

  console.log(
    `[taskmesh] payer low (${balances.gateway.formattedAvailable} USDC) — depositing ${DEPOSIT_AMOUNT}`,
  );
  await client().deposit(DEPOSIT_AMOUNT);

  // A deposit isn't spendable the moment the tx lands. Wait for Gateway to
  // credit it, or the very next pay() fails on a zero balance.
  for (let i = 0; i < 30; i++) {
    const updated = await client().getBalances();
    if (updated.gateway.available > BigInt(0)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Deposit never became spendable");
}

export interface PaidResult {
  result: string;
  paid_to: string;
  amount_usdc: string;
}

/**
 * Pay the x402 paywall on a finished task and return the unlocked work.
 *
 * `pay()` does the whole dance: GET the resource, take the 402, sign the USDC
 * authorization offchain, retry with the signature. The bounty settles to the
 * WORKER — not to us — because the paywall names them as `payTo`.
 */
export async function payForResult(resultUrl: string): Promise<PaidResult> {
  await ensureFunded();

  const { data, formattedAmount } = await client().pay<{
    result: string;
    paid_to: string;
  }>(resultUrl, { method: "GET" });

  return {
    result: data.result,
    paid_to: data.paid_to,
    amount_usdc: formattedAmount,
  };
}

/**
 * Settle a task the moment its work passes validation — no human click.
 *
 * THIS IS THE POINT OF THE WHOLE PROJECT, so it's worth being precise about what
 * changed. The pitch has always been "no human clicking approve", but until now
 * the demo still required someone to press "Pay & unlock" after validation
 * passed. That was a real contradiction between what we said and what we shipped.
 *
 * Now: work is graded, and if it passes, the bounty settles immediately. The
 * human is out of the loop entirely — post a task, walk away, the worker gets
 * paid.
 *
 * The trust model is UNCHANGED. Payment is still gated on validation, not on
 * submission — bad work still never becomes payable. We didn't remove the check;
 * we removed the button in front of it.
 *
 * Best-effort by design: this runs after the response has gone out, so a failure
 * here must never break submitting work. If it fails, the task simply stays at
 * `submitted` and the Pay button (kept as a manual fallback) can still settle it.
 */
export async function settleTask(origin: string, taskId: string): Promise<void> {
  try {
    const paid = await payForResult(`${origin}/api/tasks/${taskId}/result`);
    console.log(
      `[taskmesh] auto-settled ${paid.amount_usdc} USDC -> ${paid.paid_to} (task ${taskId.slice(0, 8)}) — no human involved`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[taskmesh] auto-settle failed for ${taskId.slice(0, 8)}: ${message} — task stays 'submitted', the Pay button can still settle it`,
    );
  }
}

/** The address the dashboard posts tasks as. */
export function payerAddress(): string | undefined {
  return process.env.BUYER_ADDRESS;
}
