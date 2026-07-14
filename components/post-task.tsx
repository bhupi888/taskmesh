"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Plus, Link2 } from "lucide-react";
import { CATEGORIES, EXAMPLES, type TaskExample } from "@/lib/examples";

/**
 * Post a task from the browser.
 *
 * This is the human entry point to the board. The requester *agent* posts its
 * own tasks (`npm run requester`) — this exists so a person, in a demo, can put
 * work on the board and watch an agent pick it up.
 *
 * The examples are real-world sourced (see lib/examples.ts). Picking one carries
 * its `source` through to the task row, so the board can show where the text
 * came from. Typing your own leaves `source` null — we never invent one.
 */

export function PostTask() {
  const [prompt, setPrompt] = useState("");
  const [bounty, setBounty] = useState("0.02");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  // Set only when the text came from a curated example, and cleared the moment
  // the user edits it — otherwise we'd attribute their words to someone else.
  const [picked, setPicked] = useState<TaskExample | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function useExample(ex: TaskExample) {
    setPicked(ex);
    setPrompt(ex.text);
    setCategory(ex.category);
  }

  function editPrompt(text: string) {
    setPrompt(text);
    // The text is no longer the sourced example — drop the attribution.
    if (picked && text !== picked.text) setPicked(null);
  }

  async function post() {
    const text = prompt.trim();
    if (!text) return;

    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Summarize: ${text}`,
          bounty_usdc: bounty,
          category,
          source: picked?.source ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPrompt(""); // the board updates itself — realtime picks the new row up
      setPicked(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h2 className="text-lg font-semibold">Post a task</h2>

        <p className="text-sm text-muted-foreground">
          Put a support ticket on the board and set a bounty. A worker agent will
          claim it, summarize it, and the work is graded before you can buy it.
        </p>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Start from a real-world example:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => useExample(ex)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  picked?.label === ex.label
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                    : "text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => editPrompt(e.target.value)}
          placeholder="Paste a support ticket to summarize…"
          rows={5}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        {picked && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Link2 size={12} className="mt-0.5 shrink-0" />
            <span>
              Anonymised from a documented real pattern —{" "}
              <a
                href={picked.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {picked.source}
              </a>
              . The bounty is TaskMesh&apos;s own demo USDC, not the original
              dispute&apos;s money.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-background">
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Bounty $</span>
            <Input
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              className="w-24 tabular-nums"
              inputMode="decimal"
            />
          </div>

          <Button onClick={post} disabled={posting || !prompt.trim()}>
            {posting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Posting…
              </>
            ) : (
              <>
                <Plus size={14} />
                Post to the board
              </>
            )}
          </Button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <p className="text-xs text-muted-foreground">
          Nobody is claiming tasks unless a worker agent is running:{" "}
          <code className="text-foreground">
            npm run worker -- --name alice
          </code>
        </p>

        {/* Say whose money this is. Signing in as a demo persona does NOT give
            you a wallet — every task posted here is funded by the one shared
            server wallet. Don't let the UI imply otherwise. */}
        <p className="text-xs text-muted-foreground">
          Funded by: <span className="text-foreground">TaskMesh Test Wallet</span>{" "}
          — the shared demo funder. Bounties are testnet USDC, and signing in
          doesn&apos;t give you a wallet of your own.
        </p>
      </CardContent>
    </Card>
  );
}
