/**
 * TaskMesh requester agent.
 *
 * Posts jobs to the board, waits for a worker to finish, then pays to unlock
 * the result. No human approves anything.
 *
 *   npm run requester
 *
 * Funding works the same way as Circle's demo agent: a fresh ephemeral wallet
 * is topped up from the funder wallet (BUYER_PRIVATE_KEY) and deposits into
 * Circle Gateway, so payments are gasless and batched.
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import {
  createWalletClient,
  createPublicClient,
  http,
  erc20Abi,
  parseUnits,
  parseEther,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as const;
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT ?? "1";
const GAS_FUND_AMOUNT = parseEther("0.01");

const BOUNTY = process.env.BOUNTY_USDC ?? "0.02";

// The jobs this agent wants done.
const JOBS = [
  "Summarize: The support ticket describes a user who cannot reset their password because the reset email never arrives. They tried three times over two days. Their address is on a corporate domain with aggressive spam filtering. The user is now locked out of a billing deadline.",
  "Summarize: A customer reports that the mobile app crashes on launch after the latest update, but only on older Android devices. They have reinstalled twice. Other devices in the same household work fine.",
];

const funderKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!funderKey) {
  console.error("Missing BUYER_PRIVATE_KEY. Run `npm run generate-wallets` first.");
  process.exit(1);
}

// --- Spin up this agent's own wallet and fund it from the funder ---
const ephemeralKey = generatePrivateKey();
const ephemeralAccount = privateKeyToAccount(ephemeralKey);
const funderAccount = privateKeyToAccount(funderKey);

console.log(`TaskMesh requester`);
console.log(`  wallet: ${ephemeralAccount.address}`);
console.log(`  board:  ${BASE_URL}\n`);

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC),
});
const funderWallet = createWalletClient({
  account: funderAccount,
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC),
});

console.log("Funding wallet...");
const gasTx = await funderWallet.sendTransaction({
  to: ephemeralAccount.address,
  value: GAS_FUND_AMOUNT,
});
await publicClient.waitForTransactionReceipt({ hash: gasTx });

const usdcTx = await funderWallet.writeContract({
  address: ARC_TESTNET_USDC,
  abi: erc20Abi,
  functionName: "transfer",
  args: [ephemeralAccount.address, parseUnits(DEPOSIT_AMOUNT, 6)],
});
await publicClient.waitForTransactionReceipt({ hash: usdcTx });

const gateway = new GatewayClient({
  chain: "arcTestnet",
  privateKey: ephemeralKey,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`Depositing ${DEPOSIT_AMOUNT} USDC into Circle Gateway...`);
await gateway.deposit(DEPOSIT_AMOUNT);

// A deposit isn't spendable the instant the tx lands — Gateway needs a moment
// to credit it. Paying before then fails on an empty balance, so wait for the
// funds to actually show up.
let balances = await gateway.getBalances();
for (let i = 0; i < 30 && balances.gateway.available === 0n; i++) {
  await sleep(2000);
  balances = await gateway.getBalances();
}
if (balances.gateway.available === 0n) {
  console.error("Gateway balance never became available — cannot pay. Aborting.");
  process.exit(1);
}
console.log(`Gateway balance: ${balances.gateway.formattedAvailable} USDC\n`);

interface TaskState {
  id: string;
  status: string;
  worker_address: string | null;
  bounty_usdc: string;
}

async function postJob(prompt: string): Promise<TaskState> {
  const res = await fetch(`${BASE_URL}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      bounty_usdc: BOUNTY,
      requester_address: ephemeralAccount.address,
    }),
  });
  if (!res.ok) throw new Error(`post failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForSubmission(id: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/tasks/${id}`);
    const task = (await res.json()) as TaskState;
    if (task.status === "submitted") return task;
    await sleep(1000);
  }
  throw new Error(`no worker submitted task ${id} within ${timeoutMs}ms`);
}

for (const prompt of JOBS) {
  const task = await postJob(prompt);
  console.log(`Posted ${task.id.slice(0, 8)} — bounty ${task.bounty_usdc} USDC`);
  console.log(`  "${prompt.slice(11, 75)}..."`);

  console.log(`  waiting for a worker...`);
  const done = await waitForSubmission(task.id);
  console.log(`  worker ${done.worker_address} finished it`);

  // The result is behind a 402. Pay for it — this settles to the WORKER.
  const { data, formattedAmount } = await gateway.pay<{
    result: string;
    paid_to: string;
  }>(`${BASE_URL}/api/tasks/${task.id}/result`, { method: "GET" });

  console.log(`  PAID ${formattedAmount} USDC -> ${data.paid_to}`);
  console.log(`  unlocked: ${data.result}\n`);
}

const final = await gateway.getBalances();
console.log(`Done. Gateway balance now: ${final.gateway.formattedAvailable} USDC`);
