/**
 * TaskMesh worker agent.
 *
 * Watches the job board, claims open tasks, does the work, submits the result,
 * and gets paid when the requester unlocks it.
 *
 * The worker never handles a payment itself. It just names an address, and the
 * x402 paywall on /api/tasks/[id]/result settles the bounty there.
 *
 *   npm run worker                 # paid to SELLER_ADDRESS
 *   npm run worker -- 0xAbC...     # paid to any address you like
 *
 * Run two at once with different addresses to see the board hand different
 * jobs to different workers, each paid to their own wallet.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const POLL_MS = 2000;

/**
 * How this worker gets paid. Two routes:
 *
 *   npm run worker -- --name alice   → TaskMesh issues it a Circle wallet.
 *                                       The agent never touches a private key.
 *   npm run worker -- 0xAbC…         → bring your own address.
 *
 * The first is the real story: an agent can join the network and start earning
 * without anyone handing it key material.
 */
const arg = process.argv[2];
let workerAddress: string;

if (arg === "--name") {
  const name = process.argv[3];
  if (!name) {
    console.error("Usage: npm run worker -- --name <worker-name>");
    process.exit(1);
  }

  const res = await fetch(`${BASE_URL}/api/workers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    console.error(`Onboarding failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const worker = (await res.json()) as {
    address: string;
    circle_wallet_id: string;
    provisioned: boolean;
  };

  workerAddress = worker.address;
  console.log(
    worker.provisioned
      ? `Onboarded "${name}" — Circle issued a new wallet`
      : `Welcome back, "${name}" — reusing your Circle wallet`,
  );
  console.log(`  Circle wallet: ${worker.circle_wallet_id}`);
} else {
  const byo = arg ?? process.env.WORKER_ADDRESS ?? process.env.SELLER_ADDRESS;
  if (!byo || !/^0x[a-fA-F0-9]{40}$/.test(byo)) {
    console.error(
      "No worker address.\n" +
        "  npm run worker -- --name alice   (Circle-issued wallet)\n" +
        "  npm run worker -- 0xYourAddress  (bring your own)",
    );
    process.exit(1);
  }
  workerAddress = byo;
}

interface Task {
  id: string;
  kind: string;
  prompt: string;
  bounty_usdc: string;
  status: string;
}

/**
 * Do the actual work.
 *
 * STUB — deliberately not an LLM yet. We're proving the payment loop first;
 * swapping this one function for a real model call is the next step and
 * changes nothing else in the system.
 */
async function doTask(task: Task): Promise<string> {
  const text = task.prompt.replace(/^Summarize:\s*/i, "").trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const summary = sentences.slice(0, 2).join(" ").trim();
  return `[stub summary] ${summary}`;
}

async function tick() {
  const res = await fetch(`${BASE_URL}/api/tasks?status=open`);
  if (!res.ok) {
    console.error(`board unreachable: HTTP ${res.status}`);
    return;
  }

  const { tasks } = (await res.json()) as { tasks: Task[] };

  for (const task of tasks) {
    // Claim it. Another worker may beat us here — that's a 409, not an error.
    const claim = await fetch(`${BASE_URL}/api/tasks/${task.id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker_address: workerAddress }),
    });

    if (claim.status === 409) {
      console.log(`  ${task.id.slice(0, 8)} — beaten to it by another worker`);
      continue;
    }
    if (!claim.ok) {
      console.error(`  ${task.id.slice(0, 8)} — claim failed: ${claim.status}`);
      continue;
    }

    console.log(`claimed ${task.id.slice(0, 8)} (${task.bounty_usdc} USDC)`);

    const result = await doTask(task);

    const submit = await fetch(`${BASE_URL}/api/tasks/${task.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker_address: workerAddress, result }),
    });

    if (!submit.ok) {
      console.error(
        `  ${task.id.slice(0, 8)} — submit failed: ${submit.status} ${await submit.text()}`,
      );
      continue;
    }

    console.log(
      `  submitted ${task.id.slice(0, 8)} — awaiting ${task.bounty_usdc} USDC to ${workerAddress}`,
    );
  }
}

console.log(`TaskMesh worker`);
console.log(`  paid to: ${workerAddress}`);
console.log(`  board:   ${BASE_URL}`);
console.log(`  watching for open tasks...\n`);

await tick();
setInterval(() => {
  tick().catch((err) => console.error("tick failed:", err.message));
}, POLL_MS);
