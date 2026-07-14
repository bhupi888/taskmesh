"use client";

import { Check, X, ListChecks, ShieldCheck } from "lucide-react";
import type { CriterionResult, TaskStatus } from "@/hooks/use-tasks";

/**
 * Makes the platform's AI validation visible on the board.
 *
 * Two states, driven by task status:
 *   - claimed  → the acceptance criteria as a neutral checklist ("here's what
 *                you're judged against"), before any grading has happened.
 *   - submitted/paid → the per-criterion verdict, each item checked or crossed,
 *                labelled "approved for payment" — this is what visually gates
 *                the "Pay & unlock" button.
 *
 * The reasoning strings are deliberately not shown here: the validator is told
 * never to reproduce the paywalled summary in them, but keeping the board to
 * criterion + met/not-met keeps the result fully behind the 402 regardless.
 */
export function ValidationChecklist({
  criteria,
  validation,
  status,
}: {
  criteria: string[] | null;
  validation: CriterionResult[] | null;
  status: TaskStatus;
}) {
  // Validated state — the work has been graded.
  if (
    (status === "submitted" || status === "paid") &&
    validation &&
    validation.length > 0
  ) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <ShieldCheck size={12} />
          validated by AI — approved for payment
        </div>
        <ul className="space-y-1">
          {validation.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              {c.met ? (
                <Check
                  size={12}
                  className="mt-0.5 shrink-0 text-emerald-400"
                />
              ) : (
                <X size={12} className="mt-0.5 shrink-0 text-red-400" />
              )}
              <span className={c.met ? "text-foreground" : "text-red-300"}>
                {c.criterion}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Understood state — criteria known, work not yet graded (on claim).
  if (criteria && criteria.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListChecks size={12} />
          will be judged on
        </div>
        <ul className="space-y-1">
          {criteria.map((c, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-xs text-muted-foreground"
            >
              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-[3px] border" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}
