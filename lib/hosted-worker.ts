import { getAddress } from "viem";
import { supabase } from "@/lib/x402";
import { provisionWorkerWallet } from "@/lib/circle-wallets";
import { summarize, validate, deriveCriteria, llmConfigured } from "@/lib/llm";

/**
 * A worker agent that lives on the server instead of on somebody's laptop.
 *
 * WHY THIS EXISTS: the board was only alive when a human was sitting at a
 * terminal running `npm run worker`. A judge opening the deployed URL would post
 * a task, watch it sit at `open` forever, and reasonably conclude the thing is
 * broken. The most natural first action anyone takes was the one action that
 * didn't work.
 *
 * "nova" is a hosted worker: same Circle wallet onboarding, same claim → work →
 * submit loop, same validation gate, same paywall. Nothing about the economics
 * or the trust model changes — it is exactly the agent in worker.mts, running on
 * our infrastructure rather than yours. The laptop workers still work, still
 * compete with nova for the same tasks, and still get paid into their own
 * wallets.
 *
 * It is woken by a task being posted (see app/api/tasks/route.ts), not by
 * polling — this project is on Vercel's Hobby plan, where cron only fires once a
 * day. Event-driven is better anyway: a judge posts and sees it claimed in
 * seconds.
 */

const HOSTED_WORKER = "nova";

/** Onboard nova the first time, then reuse the same wallet forever. */
async function novaAddress(): Promise<string> {
  const { data: existing } = await supabase
    .from("workers")
    .select("address")
    .eq("name", HOSTED_WORKER)
    .maybeSingle();

  if (existing?.address) return existing.address;

  const wallet = await provisionWorkerWallet();
  const address = getAddress(wallet.address);

  const { error } = await supabase.from("workers").insert({
    name: HOSTED_WORKER,
    // Circle returns lowercase; tasks store checksummed. Normalise, or the
    // worker_address lookup silently misses and nova works for free.
    address,
    circle_wallet_id: wallet.walletId,
    blockchain: wallet.blockchain,
  });
  if (error) throw new Error(`Could not register ${HOSTED_WORKER}: ${error.message}`);

  console.log(`[nova] onboarded — Circle wallet ${wallet.walletId} at ${address}`);
  return address;
}

/**
 * Claim one open task, do it, and submit it — the same three steps a laptop
 * worker takes, against the same tables.
 *
 * Returns the task id it worked, or null if there was nothing to do. Never
 * throws into the caller: this runs *after* the HTTP response has been sent, so
 * a failure here must not be able to break posting a task.
 */
export async function runHostedWorker(): Promise<string | null> {
  if (!llmConfigured()) return null;

  try {
    const address = await novaAddress();

    // Skip anything nova has already failed validation on — /claim would refuse
    // it with a 403 anyway (see task_rejections), so don't waste the round trip.
    const { data: refused } = await supabase
      .from("task_rejections")
      .select("task_id")
      .eq("worker_address", address);
    const blocked = new Set((refused ?? []).map((r) => r.task_id));

    const { data: open } = await supabase
      .from("tasks")
      .select("id,prompt,criteria")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(5);

    const task = (open ?? []).find((t) => !blocked.has(t.id));
    if (!task) return null;

    // The .eq("status","open") is the lock — if a laptop worker beat us to it,
    // zero rows come back and we simply stop. Same race, same rules.
    const { data: claimed } = await supabase
      .from("tasks")
      .update({
        status: "claimed",
        worker_address: address,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();

    if (!claimed) return null; // beaten to it — not an error

    console.log(`[nova] claimed ${task.id.slice(0, 8)}`);

    const result = await summarize(task.prompt);

    // Graded before it can be sold, exactly as a laptop worker's would be. Nova
    // gets no special treatment: if she submits bad work she is rejected, the
    // task goes back on the board, and she is blocked from re-claiming it.
    const criteria =
      Array.isArray(task.criteria) && task.criteria.length > 0
        ? (task.criteria as string[])
        : await deriveCriteria(task.prompt).catch(() => []);

    const verdict = await validate(task.prompt, result, criteria);

    if (!verdict.pass) {
      await supabase.from("task_rejections").upsert(
        { task_id: task.id, worker_address: address, reason: verdict.reason },
        { onConflict: "task_id,worker_address" },
      );
      await supabase
        .from("tasks")
        .update({ status: "open", worker_address: null, claimed_at: null })
        .eq("id", task.id)
        .eq("status", "claimed");

      console.log(`[nova] REJECTED ${task.id.slice(0, 8)} — ${verdict.reason}`);
      return null;
    }

    // Result into the paywalled table BEFORE flipping status: once a task is
    // `submitted` it is purchasable, so the goods must already be behind the 402.
    await supabase
      .from("task_results")
      .upsert({ task_id: task.id, result }, { onConflict: "task_id" });

    await supabase
      .from("tasks")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        criteria,
        validation: verdict.criteria,
      })
      .eq("id", task.id)
      .eq("status", "claimed")
      .eq("worker_address", address);

    console.log(`[nova] submitted ${task.id.slice(0, 8)} — awaiting payment`);
    return task.id;
  } catch (err) {
    // Posting a task must never fail because the hosted worker did.
    console.error("[nova] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
