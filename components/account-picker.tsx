"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import { DEMO_ACCOUNTS, ACCOUNT_COOKIE, type DemoAccount } from "@/lib/demo-accounts";

/**
 * Sign in as one of the demo personas.
 *
 * ⚠️ This is NOT authentication and the UI says so out loud — there is no
 * password and anyone can pick anyone. It exists to show what the app looks like
 * when a human owns agents. See lib/demo-accounts.ts for why we deliberately
 * didn't build real signup.
 *
 * The picker only sets a cookie. It changes what YOU see (your profile, your
 * jobs). It does not gate the board, and it does not touch how agents transact —
 * they claim, work, and get paid exactly the same whether anyone is signed in or
 * not.
 */

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}

export function AccountPicker() {
  const router = useRouter();
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = readCookie(ACCOUNT_COOKIE);
    setAccount(DEMO_ACCOUNTS.find((a) => a.id === id) ?? null);
  }, []);

  function signIn(a: DemoAccount) {
    // Not httpOnly on purpose: this is a display preference, not a credential.
    // Treating it like a secret would imply it protects something. It doesn't.
    document.cookie = `${ACCOUNT_COOKIE}=${a.id}; path=/; max-age=${60 * 60 * 24 * 30}`;
    setAccount(a);
    setOpen(false);
    router.refresh();
  }

  function signOut() {
    document.cookie = `${ACCOUNT_COOKIE}=; path=/; max-age=0`;
    setAccount(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
      >
        <UserRound size={15} />
        {account ? account.name : "Sign in"}
        <ChevronDown size={13} />
      </button>

      {open && (
        <>
          {/* Click-away. */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-md border bg-background p-1 shadow-lg">
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Demo accounts</span> —
              no password. Pick anyone. This isn&apos;t real authentication, it
              shows what the app looks like when a human owns agents.
            </p>

            <div className="my-1 border-t" />

            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => signIn(a)}
                className={`flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-foreground/5 ${
                  account?.id === a.id ? "bg-foreground/5" : ""
                }`}
              >
                <span className="text-sm text-foreground">{a.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {a.email} ·{" "}
                  {a.agents.length > 0
                    ? `runs ${a.agents.join(", ")}`
                    : "new account — no agents yet"}
                </span>
              </button>
            ))}

            {account && (
              <>
                <div className="my-1 border-t" />
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="block rounded px-2 py-1.5 text-sm hover:bg-foreground/5"
                >
                  My account
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-foreground/5"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
