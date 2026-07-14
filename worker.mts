/**
 * TaskMesh worker agent.
 *
 * Watches the job board, claims open tasks, does the work, submits the result,
 * and gets paid when the requester unlocks it.
 *
 * The worker never handles a payment itself. It just names an address, and the
 * x402 paywall on /api/tasks/[id]/result settles the bounty there.
 *
 *   npm run worker -- --name alice          # TaskMesh issues it a Circle wallet
 *   npm run worker -- 0xAbC...              # or bring your own address
 *   npm run worker -- --name eve --lazy     # a BAD worker: submits filler
 *   npm run worker -- --name bob --category "Billing & Payments"   # a specialist
 *
 * Run two at once to see the board hand different jobs to different workers,
 * each paid into their own wallet. Run a --lazy one to watch the platform's
 * validator reject its work and refuse to let it become payable.
 */

import { summarize, llmConfigured } from "./lib/llm.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const POLL_MS = 2000;

/** Submit filler instead of doing the job — used to demo that validation bites. */
const lazy = process.argv.includes("--lazy");

/**
 * Only claim tasks in one category — a worker that has a specialism.
 *
 * This is what makes the board a market of competing *specialists* rather than
 * a queue with one interchangeable worker: run two agents on different
 * categories and each only takes the work it's good at.
 */
const categoryFlag = process.argv.indexOf("--category");
const category =
  categoryFlag !== -1 ? process.argv[categoryFlag + 1] : undefined;

/**
 * Tasks this worker has already been rejected on.
 *
 * A rejected task goes back on the board, so without this the same worker
 * re-claims it, fails validation again, and loops — burning a validation call
 * every time. Backing off is the polite behaviour.
 *
 * NOTE: this is client-side, so it only fixes well-behaved workers. A hostile
 * worker could still spin, and every spin costs the platform one validation
 * call. The server-side fix is to record rejections per (task, worker) and
 * refuse the re-claim. Named in the README as a known gap rather than hidden.
 */
const rejected = new Set<string>();

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
 * Falls back to a crude extractive stub if no ANTHROPIC_API_KEY is set, so the
 * payment loop still runs without a model. The stub is honest about being one.
 */
async function doTask(task: Task): Promise<string> {
  // `--lazy` makes this worker a bad actor on purpose: it submits filler
  // instead of doing the job. The platform's validator should catch it and
  // refuse to let the work become payable. Use it to demo that the guard works.
  if (lazy) {
    return "Yes, this was handled. Everything looks fine overall.";
  }

  if (llmConfigured()) {
    return summarize(task.prompt);
  }

  const text = task.prompt.replace(/^Summarize:\s*/i, "").trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return `[stub summary — no ANTHROPIC_API_KEY set] ${sentences.slice(0, 2).join(" ").trim()}`;
}

async function tick() {
  const url = new URL("/api/tasks", BASE_URL);
  url.searchParams.set("status", "open");
  if (category) url.searchParams.set("category", category);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`board unreachable: HTTP ${res.status}`);
    return;
  }

  const { tasks } = (await res.json()) as { tasks: Task[] };

  for (const task of tasks) {
    // Already failed this one. Don't spin on it.
    if (rejected.has(task.id)) continue;

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
    // 403 = the platform is refusing us this task because we already failed
    // validation on it. The `rejected` Set above stops a well-behaved worker
    // from asking twice; this is what stops a hostile one. Record it locally so
    // we stop asking, and move on.
    if (claim.status === 403) {
      rejected.add(task.id);
      console.error(
        `  ${task.id.slice(0, 8)} — refused: already failed validation on this task`,
      );
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

    // 422 = the platform graded the work and rejected it. The task goes back on
    // the board and this worker earns nothing. Not a crash — the guard working.
    if (submit.status === 422) {
      const { reason } = (await submit.json()) as { reason?: string };
      rejected.add(task.id); // don't re-claim work we already failed
      console.error(
        `  ${task.id.slice(0, 8)} — REJECTED by validation: ${reason ?? "no reason given"}`,
      );
      console.error(`    (back on the board, unpaid — not retrying)`);
      continue;
    }

    if (!submit.ok) {
      console.error(
        `  ${task.id.slice(0, 8)} — submit failed: ${submit.status} ${await submit.text()}`,
      );
      continue;
    }

    console.log(
      `  submitted ${task.id.slice(0, 8)} — passed validation, awaiting ${task.bounty_usdc} USDC`,
    );
  }
}

console.log(`TaskMesh worker`);
console.log(`  paid to: ${workerAddress}`);
console.log(`  board:   ${BASE_URL}`);
if (category) console.log(`  specialism: ${category}`);
console.log(
  `  watching for open tasks${category ? ` in ${category}` : ""}...\n`,
);

await tick();
setInterval(() => {
  tick().catch((err) => console.error("tick failed:", err.message));
}, POLL_MS);
