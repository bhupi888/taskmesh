"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ExternalLink, Layers } from "lucide-react";

/**
 * Shows what actually happened to a task's money.
 *
 * The batching claim — "a two-cent task is viable because nobody pays gas per
 * payment" — is the economic core of TaskMesh, and until now the board just said
 * "paid" and asked you to take it on faith.
 *
 * The six steps below are the real Gateway lifecycle. The interesting one is the
 * gap between step 1 and step 5: the requester's authorization is signed
 * instantly and off-chain, the worker is paid at that moment, and the on-chain
 * batch transaction lands minutes later, settling this payment together with
 * everyone else's. One transaction, many payments. That gap is the product.
 */

const EXPLORER_TX = "https://testnet.arcscan.app/tx";

interface Trace {
  settlement_id: string;
  amount_usdc: string;
  status: string;
  batch_tx: string | null;
  authorized_at: string;
  settled_at: string | null;
}

function elapsed(from: string, to: string): string {
  const secs = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  if (!Number.isFinite(secs) || secs < 0) return "";
  if (secs < 90) return `${secs.toFixed(0)}s`;
  return `${(secs / 60).toFixed(1)} min`;
}

export function PaymentTrace({ taskId }: { taskId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/tasks/${taskId}/payment`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as Trace;
      if (cancelled) return;
      setTrace(data);
      // Keep polling only while the batch is still in flight — once it's on
      // chain there is nothing left to change.
      if (data.status !== "completed") setTimeout(load, 5000);
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [taskId, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        <Layers size={11} />
        trace the payment
      </button>
    );
  }

  const onChain = trace?.status === "completed" && trace.batch_tx;

  // Steps 1–3 are complete the moment a settlement UUID exists at all: the
  // authorization was signed, the facilitator accepted it, and the worker's
  // earnings were credited. 4–6 depend on the relayer flushing the batch.
  const steps: { label: string; done: boolean; detail?: React.ReactNode }[] = [
    {
      label: "Requester signs a USDC authorization — off-chain, zero gas",
      done: Boolean(trace),
    },
    {
      label: "Circle's facilitator verifies and accepts it",
      done: Boolean(trace),
      detail: trace ? (
        <span className="font-mono text-[10px]">
          {trace.settlement_id.slice(0, 8)}…
        </span>
      ) : undefined,
    },
    {
      label: "Worker is credited — the bounty is theirs from this moment",
      done: Boolean(trace),
    },
    {
      label: "Payment waits in a batch with everyone else's",
      done: Boolean(onChain),
    },
    {
      label: "One on-chain transaction settles the whole batch",
      done: Boolean(onChain),
      detail: onChain ? (
        <a
          href={`${EXPLORER_TX}/${trace!.batch_tx}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 font-mono text-[10px] underline underline-offset-2 hover:text-foreground"
        >
          {trace!.batch_tx!.slice(0, 10)}…
          <ExternalLink size={9} />
        </a>
      ) : undefined,
    },
    {
      label: "Earnings move from pending batch to settled balance",
      done: Boolean(onChain),
    },
  ];

  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">Payment trace</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          hide
        </button>
      </div>

      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px]">
            {s.done ? (
              <Check size={11} className="mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <Loader2
                size={11}
                className="mt-0.5 shrink-0 animate-spin text-muted-foreground"
              />
            )}
            <span
              className={s.done ? "text-foreground" : "text-muted-foreground"}
            >
              {s.label}
              {s.detail && <> — {s.detail}</>}
            </span>
          </li>
        ))}
      </ol>

      {trace && !onChain && (
        <p className="text-[10px] text-muted-foreground">
          Still batching. The worker already has the money — the chain is
          catching up.
        </p>
      )}

      {trace?.settled_at && (
        <p className="text-[10px] text-muted-foreground">
          Paid instantly; batch landed on-chain{" "}
          <span className="text-foreground">
            {elapsed(trace.authorized_at, trace.settled_at)}
          </span>{" "}
          later — in one transaction, shared with every other payment in it.
        </p>
      )}
    </div>
  );
}
