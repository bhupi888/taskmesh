import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/x402";
import { payerAddress } from "@/lib/payer";
import { deriveCriteria, llmConfigured } from "@/lib/llm";

/**
 * The job board.
 *
 * POST — a requester agent posts a task with a bounty. Free; you pay on
 *        collection, not on posting.
 * GET  — list tasks. Never returns `result`: that's the paywalled goods,
 *        and it only comes out of /api/tasks/[id]/result after payment.
 */

/**
 * `requester_address` is optional. An agent posting for itself supplies its own
 * address; the dashboard doesn't have a wallet, so it posts as the server's
 * funder — the same wallet its "Pay & unlock" button spends from.
 */
const PostTask = z.object({
  prompt: z.string().min(1).max(10_000),
  bounty_usdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "e.g. \"0.02\""),
  requester_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  kind: z.literal("summarize").default("summarize"),
});

// Everything except `result` — see above. `criteria`/`validation` are the
// acceptance-criteria checklist and its per-criterion verdict; both are safe to
// expose (they never contain the paywalled result — see the 20260714010000
// migration and lib/llm.ts).
const PUBLIC_COLUMNS =
  "id,created_at,kind,prompt,requester_address,bounty_usdc,status,worker_address,claimed_at,submitted_at,paid_at,criteria,validation";

export async function POST(req: NextRequest) {
  const parsed = PostTask.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid task", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const requester = parsed.data.requester_address ?? payerAddress();
  if (!requester) {
    return NextResponse.json(
      { error: "No requester_address, and no server funder configured" },
      { status: 400 },
    );
  }

  // Derive the acceptance criteria now, so a worker sees what it's judged
  // against the moment it claims. Best-effort: if the LLM isn't configured or
  // the call fails, the task still posts — it just has no checklist to show.
  let criteria: string[] | null = null;
  if (llmConfigured()) {
    try {
      const derived = await deriveCriteria(parsed.data.prompt);
      criteria = derived.length ? derived : null;
    } catch (err) {
      console.error("[taskmesh] criteria derivation failed:", err);
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...parsed.data, requester_address: requester, criteria })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[taskmesh] posted ${data.id} — ${data.bounty_usdc} USDC — "${data.prompt.slice(0, 60)}"`,
  );
  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("tasks")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data });
}
