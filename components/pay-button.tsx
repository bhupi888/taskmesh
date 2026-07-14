"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

/**
 * Settlement status — deliberately NOT a button any more.
 *
 * This used to be "Pay & unlock": a thing a human clicked after validation
 * passed. That was the one place the demo contradicted the pitch — we said "no
 * human clicking approve", then made you click approve.
 *
 * The bounty now settles automatically the moment work passes validation (see
 * `settleTask` in lib/payer.ts). So a task sitting at `submitted` isn't waiting
 * on you — it's mid-settlement, and flips to `paid` on its own over realtime.
 *
 * THE ABSENCE OF A BUTTON IS THE FEATURE. Don't put one back as the primary
 * action. The manual path still exists (POST /api/tasks/:id/pay) and is surfaced
 * here only if auto-settlement visibly failed, so a worker never ends up
 * silently unpaid.
 */
export function PayButton({
  taskId,
  bounty,
}: {
  taskId: string;
  bounty: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);

  // Settlement can legitimately take ~15s when the payer needs an on-chain
  // Gateway top-up first. Well past that, something actually went wrong.
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), 45_000);
    return () => clearTimeout(t);
  }, []);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/pay`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      }
      // The board picks the flip to `paid` up over realtime — nothing to set.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  if (stuck) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle size={12} />
          settlement didn&apos;t complete
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {retrying ? "retrying…" : `retry settling $${bounty}`}
        </button>
        {error && <p className="max-w-xs text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="animate-spin" size={12} />
      settling ${bounty} to the worker — nobody approves this
    </div>
  );
}
