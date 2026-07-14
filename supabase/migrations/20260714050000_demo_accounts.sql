-- Replace the real-auth accounts model with demo accounts.
--
-- WHY THE CHANGE: 20260714040000 built this on Supabase Auth (real signup, real
-- passwords, auth.users). We are deliberately NOT doing that. Signup would have
-- meant an email-confirmation round trip on Supabase's rate-limited SMTP, which
-- a judge would hit as a dead end mid-demo — and real auth adds nothing to the
-- thing being demonstrated. The agents are the point; the human account is only
-- an ownership/visibility layer.
--
-- SO: five fixed demo personas, picked from a dropdown, no password. This is
-- explicitly labelled as a demo persona switcher in the UI — it must never be
-- presented as real authentication, because it isn't. Anyone can be anyone.
--
-- The two populated personas own REAL agents (alice, bob) whose earnings and
-- completed jobs are genuine — real work, real settled USDC. Nothing about their
-- history is fabricated. The other three are empty on purpose, so a judge can
-- see what a brand-new account looks like.
--
-- Agent ownership is declared in lib/demo-accounts.ts, not in the database:
-- these are fixed personas, not user data. Only `posted_by` needs to persist.

drop table if exists public.account_agents;

-- Was a uuid referencing auth.users. Now just the demo account's id
-- ("maya", "tom", …). Null for anonymous posting and for tasks posted by a
-- requester agent — both must keep working exactly as before. This is additive.
alter table public.tasks
  drop column if exists posted_by;

alter table public.tasks
  add column if not exists posted_by text;

create index if not exists tasks_posted_by_idx
  on public.tasks (posted_by);
