import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/x402";

/**
 * A single task's public state. Deliberately omits `result` — that only comes
 * out of /api/tasks/[id]/result, and only after payment.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id,created_at,kind,prompt,requester_address,bounty_usdc,status,worker_address,claimed_at,submitted_at,paid_at,criteria,validation",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  }

  return NextResponse.json(data);
}
