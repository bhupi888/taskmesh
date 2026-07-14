import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Live view of the job board.
 *
 * Tasks change state as agents work — open -> claimed -> submitted -> paid —
 * so this subscribes to Postgres changes rather than polling. The board on
 * screen moves as the agents move.
 *
 * `result` is deliberately never selected: it's the paywalled goods, and the
 * anon key can read the column. It only comes out of /api/tasks/[id]/result
 * after payment.
 */

export type TaskStatus = "open" | "claimed" | "submitted" | "paid";

/** One acceptance criterion and how the submitted work scored against it. */
export type CriterionResult = {
  criterion: string;
  met: boolean;
  reasoning: string;
};

export type Task = {
  id: string;
  created_at: string;
  kind: string;
  prompt: string;
  requester_address: string;
  bounty_usdc: string;
  status: TaskStatus;
  worker_address: string | null;
  claimed_at: string | null;
  submitted_at: string | null;
  paid_at: string | null;
  // Acceptance criteria derived at post time (shown on claim), and the
  // per-criterion verdict written at validation (shown once submitted).
  criteria: string[] | null;
  validation: CriterionResult[] | null;
  // The domain the ticket belongs to (a filter dimension), and where its text
  // came from if it came from a curated real example. `source` is null for
  // freeform tasks — it is never invented.
  category: string | null;
  source: string | null;
};

const COLUMNS =
  "id,created_at,kind,prompt,requester_address,bounty_usdc,status,worker_address,claimed_at,submitted_at,paid_at,criteria,validation,category,source";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function fetchInitial() {
      const { data, error } = await supabase
        .from("tasks")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Failed to fetch tasks:", error.message);
      } else if (data) {
        setTasks(data as Task[]);
      }
      setLoading(false);
    }

    const channel = supabase
      .channel("tasks-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        (payload) => {
          const row = payload.new as Task;
          setTasks((prev) =>
            prev.some((t) => t.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          const row = payload.new as Task;
          setTasks((prev) =>
            prev.map((t) => (t.id === row.id ? { ...t, ...row } : t)),
          );
        },
      )
      .subscribe((status) => {
        // Fetch only once subscribed, so nothing slips through the gap.
        if (status === "SUBSCRIBED") fetchInitial();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { tasks, loading };
}
