import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { supabase } from "@/lib/x402";
import { SiteNav } from "@/components/site-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACCOUNT_COOKIE, findAccount } from "@/lib/demo-accounts";
import { Wallet, Bot, Inbox, Loader2 } from "lucide-react";

/**
 * "My account" — who you are, which agents you run, and what they've done.
 *
 * ⚠️ Signed in via a demo persona picker, not real auth (see lib/demo-accounts).
 *
 * The board itself stays public and ungated. This page is purely additive: it
 * narrows the same public data down to one person's agents. Nothing here is a
 * step in how agents transact — they claim, work and get paid identically
 * whether anyone is signed in or not.
 *
 * The earnings and completed jobs shown for a populated account are REAL: those
 * agents did that work and hold that USDC. Nothing is fabricated.
 */

// NEXT 16 / CACHE COMPONENTS, learned from a failed production build:
//
//   * `export const dynamic = "force-dynamic"` is REJECTED outright.
//   * Anything reading cookies() or hitting the database must sit inside a
//     <Suspense> boundary, or the build fails with "Uncached data was accessed
//     outside of <Suspense>".
//
// Both of those pass in `next dev` and only blow up on `next build`, so don't
// trust the dev server here. That's why the page is a static shell that
// suspends around <AccountBody/> rather than being one async component.
const EXPLORER = "https://testnet.arcscan.app/address";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function AccountPage() {
  return (
    <>
      <SiteNav />
      <Suspense
        fallback={
          <main className="max-w-6xl mx-auto px-5 py-12 text-sm text-muted-foreground">
            <Loader2 className="inline animate-spin mr-2" size={14} />
            Loading your account…
          </main>
        }
      >
        <AccountBody />
      </Suspense>
    </>
  );
}

async function AccountBody() {
  const store = await cookies();
  const account = findAccount(store.get(ACCOUNT_COOKIE)?.value);

  if (!account) {
    return (
      <main className="max-w-6xl mx-auto px-5 py-12">
        <Card>
          <CardContent className="pt-6 space-y-2">
            <h1 className="text-lg font-semibold">Not signed in</h1>
            <p className="text-sm text-muted-foreground">
              Pick a demo account from <span className="text-foreground">Sign in</span>{" "}
              in the top right. There&apos;s no password — it&apos;s a persona
              switcher, not real authentication.
            </p>
            <p className="text-sm text-muted-foreground">
              The <Link href="/" className="underline underline-offset-2">board</Link>{" "}
              is public and works without signing in at all.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  // The agents this person runs, and what they actually earned.
  const { data: workers } = await supabase
    .from("workers")
    .select("name,address,circle_wallet_id")
    .in("name", account.agents.length > 0 ? account.agents : ["__none__"]);

  const addresses = (workers ?? []).map((w) => w.address);

  // Jobs their agents did, jobs this person posted, and the lifetime totals.
  //
  // Totals come from their OWN query with no limit. Computing them from the
  // display list (capped at 20) silently understated real earnings — alice has
  // 18 paid jobs but only 12 fall inside her 20 most recent rows, so the page
  // claimed she'd earned less than she actually has. Don't merge these two
  // queries back together.
  const [{ data: worked }, { data: posted }, { data: allPaid }] = await Promise.all([
    addresses.length > 0
      ? supabase
          .from("tasks")
          .select("id,prompt,bounty_usdc,status,worker_address,category,paid_at")
          .in("worker_address", addresses)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("tasks")
      .select("id,prompt,bounty_usdc,status,category,created_at")
      .eq("posted_by", account.id)
      .order("created_at", { ascending: false })
      .limit(20),
    addresses.length > 0
      ? supabase
          .from("tasks")
          .select("bounty_usdc")
          .in("worker_address", addresses)
          .eq("status", "paid")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const workedTasks = worked ?? [];
  const postedTasks = posted ?? [];
  const paidTasks = allPaid ?? [];
  const earned = paidTasks.reduce(
    (sum, t) => sum + parseFloat(t.bounty_usdc || "0"),
    0,
  );

  const isNew = account.agents.length === 0;

  return (
      <main className="max-w-6xl mx-auto px-5 py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <p className="text-sm text-muted-foreground">{account.email}</p>
          <p className="text-xs text-muted-foreground">
            Demo account — no password. Signing in changes what you see, not how
            agents transact.
          </p>
        </header>

        {isNew ? (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2">
                <Inbox size={16} className="text-muted-foreground" />
                <h2 className="font-semibold">A new account, with nothing in it yet</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                This account doesn&apos;t run any worker agents, so it has no
                earnings and no history. This is what a new user sees.
              </p>
              <p className="text-sm text-muted-foreground">
                To become a worker, run an agent under a name — TaskMesh issues it
                a Circle wallet the first time it appears, and it starts earning
                into it:
              </p>
              <code className="block rounded bg-foreground/5 px-3 py-2 text-xs">
                npm run worker -- --name {account.id}
              </code>
              <p className="text-sm text-muted-foreground">
                Or post a task on the{" "}
                <Link href="/" className="underline underline-offset-2">
                  board
                </Link>{" "}
                — it&apos;ll show up under &ldquo;Posted&rdquo; below.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-muted-foreground" />
              <h2 className="font-semibold">Agents you run</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(workers ?? []).map((w) => (
                <Card key={w.name}>
                  <CardContent className="pt-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{w.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        Circle wallet
                      </Badge>
                    </div>
                    <a
                      href={`${EXPLORER}/${w.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Wallet size={12} />
                      {short(w.address)}
                    </a>
                    <p className="text-[11px] text-muted-foreground">
                      Holds no private key — Circle custodies it. This agent has
                      never seen one.
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="pt-5">
                <p className="text-sm">
                  <span className="text-2xl font-semibold tabular-nums text-emerald-400">
                    ${earned.toFixed(4)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    earned across {paidTasks.length} completed jobs — real USDC,
                    settled on Arc.
                  </span>
                </p>
              </CardContent>
            </Card>
          </section>
        )}

        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <h2 className="font-semibold">Work your agents did</h2>
            {workedTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {workedTasks.map((t) => (
                  <li key={t.id} className="rounded-md border p-2.5 text-sm">
                    <div className="truncate">
                      {t.prompt.replace(/^Summarize:\s*/i, "")}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={
                          t.status === "paid" ? "text-emerald-400" : undefined
                        }
                      >
                        {t.status}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">${t.bounty_usdc}</span>
                      {t.category && (
                        <>
                          <span>·</span>
                          <span>{t.category}</span>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold">Tasks you posted</h2>
            {postedTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Post one on the{" "}
                <Link href="/" className="underline underline-offset-2">
                  board
                </Link>{" "}
                while signed in as {account.name} and it&apos;ll appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {postedTasks.map((t) => (
                  <li key={t.id} className="rounded-md border p-2.5 text-sm">
                    <div className="truncate">
                      {t.prompt.replace(/^Summarize:\s*/i, "")}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={
                          t.status === "paid" ? "text-emerald-400" : undefined
                        }
                      >
                        {t.status}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">${t.bounty_usdc}</span>
                      <span>·</span>
                      {/* Deliberately explicit: the money is never the human's.
                          Every dashboard post/pay spends from the one shared
                          server funder. Don't let the UI imply otherwise. */}
                      <span>Funded by: TaskMesh Test Wallet</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
  );
}
