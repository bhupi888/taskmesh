import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

/**
 * Circle Wallets — how a worker agent gets paid without ever holding a key.
 *
 * Circle's reference demo generates raw private keys with a script and leaves
 * them in a .env file. That's fine for a demo and impossible in production:
 * you cannot onboard strangers' agents by emailing them private keys.
 *
 * Here, TaskMesh provisions a Circle developer-controlled (MPC) wallet for each
 * worker. The worker gets an address to be paid at; Circle custodies the key;
 * the worker never sees one. That's the onboarding story.
 */

const ARC = "ARC-TESTNET" as const;

let client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null =
  null;

function circle() {
  if (!client) {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    if (!apiKey || !entitySecret) {
      throw new Error(
        "Circle Wallets not configured — CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set. Run `node --env-file=.env.local circle-setup.mts`.",
      );
    }
    client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  }
  return client;
}

/**
 * All TaskMesh worker wallets live in one wallet set. The id is pinned in
 * .env.local so we don't create a new set on every cold start.
 */
async function walletSetId(): Promise<string> {
  const pinned = process.env.CIRCLE_WALLET_SET_ID;
  if (pinned) return pinned;

  const res = await circle().createWalletSet({ name: "TaskMesh Workers" });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error("Circle did not return a wallet set id");

  console.warn(
    `[circle] created wallet set ${id} — pin this as CIRCLE_WALLET_SET_ID in .env.local`,
  );
  return id;
}

export interface ProvisionedWallet {
  walletId: string;
  address: string;
  blockchain: string;
}

/** Issue a fresh Arc wallet for a worker. Circle holds the key; we get an address. */
export async function provisionWorkerWallet(): Promise<ProvisionedWallet> {
  const res = await circle().createWallets({
    walletSetId: await walletSetId(),
    blockchains: [ARC],
    count: 1,
    accountType: "EOA",
  });

  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle did not return a usable wallet");
  }

  return {
    walletId: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain ?? ARC,
  };
}

/**
 * Worker earnings are NOT read from here.
 *
 * A worker's pay lands in Circle Gateway, not in the wallet itself — Gateway
 * batches nanopayments and settles them, so the wallet's own token balance
 * stays at zero until a withdrawal happens (and see the README: a Circle-Wallet
 * worker can't withdraw through Gateway's SDK yet, because that SDK wants a raw
 * private key Circle never exposes).
 *
 * So earnings come from Gateway's balances API instead — see
 * app/api/workers/earnings/route.ts. If you ever do need the wallet's own
 * on-chain balance, the call is `getWalletTokenBalance({ id })`. Do NOT reach
 * for `getWallet` / `getWallets`: Circle's own guidance says those endpoints
 * never return balance data.
 */
