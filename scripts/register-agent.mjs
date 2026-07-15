/**
 * Register TaskMesh's worker agent (nova) with an on-chain identity on Arc
 * Testnet, using the ERC-8004 IdentityRegistry.
 *
 *   node scripts/register-agent.mjs          # register (one-time)
 *   node scripts/register-agent.mjs --check   # read back an existing identity, no writes
 *
 * WHY: ERC-8004 gives an autonomous agent a verifiable on-chain identity — a
 * credible "path to production" signal (a real marketplace would want to know
 * which agent it's paying). It is deliberately ONE-TIME. Per the project notes:
 * do NOT extend this to per-job reputation writes — one on-chain write per task
 * reintroduces exactly the gas-cost objection TaskMesh uses against escrow. This
 * is identity only.
 *
 * HOW: the registration is a contract call — register(metadataURI) on the
 * IdentityRegistry — executed through a Circle developer-controlled wallet via
 * createContractExecutionTransaction. Same Circle Wallets SDK the workers
 * already use; no raw private key involved. The wallet is an SCA so Circle's Gas
 * Station sponsors the (~0.006 USDC) fee — nothing to fund by hand.
 *
 * IDEMPOTENCY: once registered, pin AGENT_OWNER_WALLET_ID (and the printed
 * AGENT_IDENTITY_ID) in .env.local. Re-running with AGENT_OWNER_WALLET_ID set
 * reuses that wallet instead of minting a second identity.
 *
 * Needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID in .env.local.
 */

import { readFileSync } from "node:fs";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, parseAbiItem, getContract } from "viem";
import { arcTestnet } from "viem/chains";

// Load .env.local (no dotenv dependency). Tolerant of CRLF endings and of
// values that themselves contain `=` or `:` (Circle API keys do) — split on the
// FIRST `=` only, don't regex the whole line.
for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const line = raw.replace(/\r$/, "");
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
  if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
}

// ERC-8004 registries on Arc Testnet (from Arc's official quickstart).
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const METADATA_URI =
  process.env.AGENT_METADATA_URI || "https://taskmesh-arc.vercel.app/agent.json";

const CHECK_ONLY = process.argv.includes("--check");

const circle = initiateDeveloperControlledWalletsClient({
  apiKey: reqEnv("CIRCLE_API_KEY"),
  entitySecret: reqEnv("CIRCLE_ENTITY_SECRET"),
});

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

const identity = getContract({
  address: IDENTITY_REGISTRY,
  abi: [
    parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ),
    {
      name: "ownerOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ name: "", type: "address" }],
    },
    {
      name: "tokenURI",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ name: "", type: "string" }],
    },
  ],
  client: publicClient,
});

function reqEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local — cannot continue.`);
    process.exit(1);
  }
  return v;
}

async function waitForTx(txId, label) {
  process.stdout.write(`  waiting for ${label}`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await circle.getTransaction({ id: txId });
    const state = data?.transaction?.state;
    if (state === "COMPLETE") {
      console.log(" done");
      return data.transaction.txHash;
    }
    if (state === "FAILED") throw new Error(`${label} failed on-chain`);
    process.stdout.write(".");
  }
  throw new Error(`${label} timed out`);
}

/** Find the identity token minted to `owner`, if any. */
async function findIdentity(owner) {
  const latest = await publicClient.getBlockNumber();
  const range = 10000n; // eth_getLogs is commonly capped at 10k blocks
  const logs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ),
    args: { to: owner },
    fromBlock: latest > range ? latest - range : 0n,
    toBlock: latest,
  });
  if (logs.length === 0) return null;
  const tokenId = logs[logs.length - 1].args.tokenId;
  const uri = await identity.read.tokenURI([tokenId]);
  return { agentId: tokenId.toString(), tokenURI: uri };
}

async function ownerWalletAddress(walletId) {
  const { data } = await circle.getWallet({ id: walletId });
  const addr = data?.wallet?.address;
  if (!addr) throw new Error(`Wallet ${walletId} has no address`);
  return addr;
}

async function main() {
  const pinnedWalletId = process.env.AGENT_OWNER_WALLET_ID;

  // --check, or an already-pinned wallet: read back, never write.
  if (CHECK_ONLY || pinnedWalletId) {
    if (!pinnedWalletId) {
      console.error("--check needs AGENT_OWNER_WALLET_ID pinned in .env.local.");
      process.exit(1);
    }
    const address = await ownerWalletAddress(pinnedWalletId);
    const existing = await findIdentity(address);
    if (existing) {
      console.log("Already registered:");
      console.log(`  owner wallet:  ${address} (${pinnedWalletId})`);
      console.log(`  agent id:      ${existing.agentId}`);
      console.log(`  metadata URI:  ${existing.tokenURI}`);
      console.log(`  explorer:      https://testnet.arcscan.app/address/${address}`);
      return;
    }
    if (CHECK_ONLY) {
      console.log(`No identity found for pinned wallet ${address}.`);
      return;
    }
    // Pinned wallet but no identity yet — fall through and register it.
    console.log(`Pinned wallet ${address} has no identity yet — registering it.`);
    await register(pinnedWalletId, address);
    return;
  }

  // Fresh run: mint a dedicated SCA owner wallet in the pinned wallet set.
  console.log("── Creating agent owner wallet (SCA, gas sponsored) ──");
  const created = await circle.createWallets({
    walletSetId: reqEnv("CIRCLE_WALLET_SET_ID"),
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "SCA",
  });
  const wallet = created.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) throw new Error("Circle did not return a wallet");
  console.log(`  wallet: ${wallet.address} (${wallet.id})`);
  await register(wallet.id, wallet.address);
}

async function register(walletId, address) {
  console.log("\n── Registering identity (register) ──");
  console.log(`  metadata URI: ${METADATA_URI}`);
  const tx = await circle.createContractExecutionTransaction({
    walletId,
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: "register(string)",
    abiParameters: [METADATA_URI],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const txHash = await waitForTx(tx.data?.id, "registration");
  console.log(`  tx: https://testnet.arcscan.app/tx/${txHash}`);

  console.log("\n── Reading back agent id ──");
  const found = await findIdentity(address);
  if (!found) throw new Error("Registered but no Transfer event found for the wallet");
  console.log(`  agent id:     ${found.agentId}`);
  console.log(`  owner:        ${address}`);
  console.log(`  metadata URI: ${found.tokenURI}`);

  console.log("\nDone. Pin these in .env.local so re-runs don't mint a second identity:");
  console.log(`  AGENT_OWNER_WALLET_ID=${walletId}`);
  console.log(`  AGENT_IDENTITY_ID=${found.agentId}`);
}

main().catch((err) => {
  console.error("\nregister-agent failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
