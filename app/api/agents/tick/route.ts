import { NextResponse } from "next/server";
import { runHostedWorker } from "@/lib/hosted-worker";

/**
 * Run the hosted worker once, on demand.
 *
 * Posting a task already wakes nova (see /api/tasks), so this is a backstop, not
 * the main path. It matters for the case where a task is posted while nova is
 * mid-job: she takes one task per wake, so the second one waits. Hitting this
 * drains the queue.
 *
 * Deliberately unauthenticated. It cannot create work, spend money, or reveal
 * anything paywalled — the worst a caller can do is make an agent do a job that
 * was already posted and sitting open, which is the entire point of the board.
 */

export const maxDuration = 60;

export async function POST() {
  const id = await runHostedWorker();
  return NextResponse.json(
    id
      ? { worked: id }
      : { worked: null, detail: "nothing open, or another worker got there first" },
  );
}
