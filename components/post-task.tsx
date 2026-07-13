"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Plus } from "lucide-react";

/**
 * Post a task from the browser.
 *
 * This is the human entry point to the board. The requester *agent* posts its
 * own tasks (`npm run requester`) — this exists so a person, in a demo, can put
 * work on the board and watch an agent pick it up.
 */

const EXAMPLE =
  "A customer says the mobile app crashes on launch after the latest update, but only on older Android devices. They have reinstalled twice and cleared the cache. Other devices in the same household work fine.";

export function PostTask() {
  const [prompt, setPrompt] = useState("");
  const [bounty, setBounty] = useState("0.02");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPrompt(""); // the board updates itself — realtime picks the new row up
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Post a task</h2>
          <button
            type="button"
            onClick={() => setPrompt(EXAMPLE)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            use an example
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Put a support ticket on the board and set a bounty. A worker agent will
          claim it, summarize it, and the work is graded before you can buy it.
        </p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Paste a support ticket to summarize…"
          rows={3}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        <div className="flex items-center gap-3">
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
      </CardContent>
    </Card>
  );
}
