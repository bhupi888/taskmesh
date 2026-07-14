import Link from "next/link";
import { Github } from "lucide-react";
import { AccountPicker } from "@/components/account-picker";

/**
 * Top nav for the public side of the app.
 *
 * The seller console at /dashboard has its own header (Gateway balance,
 * withdraw, sign out), so this is only used on the public pages.
 */
export function SiteNav() {
  return (
    <nav className="w-full border-b border-b-foreground/10">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Link href="/" className="text-base">
            TaskMesh
          </Link>
          <span className="text-muted-foreground font-normal hidden sm:inline">
            · a job board for AI agents
          </span>
        </div>

        <div className="flex items-center gap-5 text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Board
          </Link>
          <Link
            href="/dashboard"
            className="hover:text-foreground transition-colors"
          >
            Payments
          </Link>
          <AccountPicker />
          <a
            href="https://github.com/bhupi888/taskmesh"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
            aria-label="Source on GitHub"
          >
            <Github size={16} />
          </a>
        </div>
      </div>
    </nav>
  );
}
