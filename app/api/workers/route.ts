import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/x402";
import { provisionWorkerWallet } from "@/lib/circle-wallets";

/**
 * Worker onboarding.
 *
 * A worker agent shows up wanting to earn. TaskMesh issues it a Circle wallet
 * and hands back an address. The agent never generates, sees, or stores a
 * private key — Circle custodies it.
 *
 * Idempotent by name: an agent that restarts keeps its wallet and its earnings.
 */

const Onboard = z.object({
  name: z.string().min(1).max(64),
});

export async function POST(req: NextRequest) {
  const parsed = Onboard.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const { name } = parsed.data;

  // Already onboarded? Give back the same wallet — don't mint a second one.
  const { data: existing, error: lookupError } = await supabase
    .from("workers")
    .select("id,name,address,circle_wallet_id,created_at")
    .eq("name", name)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ ...existing, provisioned: false });
  }

  let wallet;
  try {
    wallet = await provisionWorkerWallet();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[taskmesh] Circle wallet provisioning failed:", message);
    return NextResponse.json(
      { error: "Could not provision a Circle wallet", detail: message },
      { status: 502 },
    );
  }

  const { data, error } = await supabase
    .from("workers")
    .insert({
      name,
      address: wallet.address,
      circle_wallet_id: wallet.walletId,
      blockchain: wallet.blockchain,
    })
    .select("id,name,address,circle_wallet_id,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[taskmesh] onboarded worker "${name}" — Circle wallet ${wallet.walletId} at ${wallet.address}`,
  );
  return NextResponse.json({ ...data, provisioned: true }, { status: 201 });
}

export async function GET() {
  const { data, error } = await supabase
    .from("workers")
    .select("id,name,address,circle_wallet_id,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ workers: data });
}
