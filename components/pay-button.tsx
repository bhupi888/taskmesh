"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, Unlock } from "lucide-react";

/**
 * "Pay & unlock" — the human end of the x402 paywall.
 *
 * The work is finished and sitting behind a 402. Clicking this signs a USDC
 * authorization server-side and settles the bounty to the WORKER, then shows
 * the result that was being withheld.
 *
 * The first click after the payer runs low can take ~15s (an on-chain Gateway
 * deposit). Every one after that is instant — that's batching doing its job.
 */
export function PayButton({
  taskId,
  bounty,
}: {
  taskId: string;
  bounty: string;
}) {
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/pay`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      setResult(body.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Unlock size={12} />
          unlocked
        </div>
        <p className="text-sm">{result}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={pay} disabled={paying}>
        {paying ? (
          <>
            <Loader2 className="animate-spin" size={13} />
            Paying…
          </>
        ) : (
          <>
            <Lock size={13} />
            Pay ${bounty} &amp; unlock
          </>
        )}
      </Button>
      {error && <p className="text-xs text-red-400 max-w-xs">{error}</p>}
    </div>
  );
}
