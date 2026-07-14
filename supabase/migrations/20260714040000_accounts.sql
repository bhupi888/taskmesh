-- TaskMesh accounts: a human owns agents. The agents still do all the work.
--
-- READ THIS BEFORE CHANGING ANY OF IT.
--
-- WHAT AN ACCOUNT IS: a human who OWNS one or more worker agents. It is NOT a
-- new party to the transaction. The agents still post, claim, work, and get paid
-- exactly as before — signing in is an ownership/visibility layer on top of the
-- autonomous flow, never a step inside it. That distinction is what keeps this
-- in the Agentic Economy track: if a human became the one doing the work, the
-- whole premise would collapse.
--
-- WHAT THIS DELIBERATELY IS NOT:
--   * NOT poster/worker account TYPES (that's the contractor-pivot role concept,
--     explicitly not chosen).
--   * NOT a wallet per human. Every dashboard-initiated post/pay keeps spending
--     from the ONE shared server funder ("TaskMesh Test Wallet"). Giving humans
--     their own funder wallet was considered and rejected: it adds funding
--     friction, and it nudges the human toward personally transacting, which is
--     the exact ambiguity we're avoiding. Per-user history comes from
--     tasks.posted_by — a database link, not a new financial identity.
--
-- THE BOARD STAYS PUBLIC. Nothing here gates it. This project already had one
-- incident where a login wall (Vercel Deployment Protection) would have bounced
-- judges off the live demo. Do not recreate that.

-- Which worker agents a human owns. A worker is identified by the name it runs
-- under (`npm run worker -- --name alice`) and the Circle wallet address that
-- name resolves to.
create table if not exists public.account_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  worker_name text not null,
  -- Checksummed (EIP-55), matching how /claim and /submit normalise addresses.
  worker_address text not null,
  linked_at timestamptz not null default now()
);

-- One owner per worker name: two people can't both claim to run `alice`.
create unique index if not exists account_agents_worker_name_idx
  on public.account_agents (worker_name);

create index if not exists account_agents_user_idx
  on public.account_agents (user_id);

-- Who posted a task, IF a signed-in human posted it from the dashboard.
-- Null for anonymous posting and for tasks posted by a requester agent — both
-- must keep working exactly as today. This is additive.
alter table public.tasks
  add column if not exists posted_by uuid references auth.users (id) on delete set null;

create index if not exists tasks_posted_by_idx
  on public.tasks (posted_by);

-- Row Level Security on the new table ONLY.
--
-- `tasks` is deliberately left alone: the board is public and unauthenticated,
-- and every write to it goes through our API routes using the service role key
-- (which bypasses RLS anyway). Turning RLS on for `tasks` here would buy nothing
-- and risks breaking the public board.
alter table public.account_agents enable row level security;

drop policy if exists "own agents readable" on public.account_agents;
create policy "own agents readable" on public.account_agents
  for select using (auth.uid() = user_id);

drop policy if exists "own agents insertable" on public.account_agents;
create policy "own agents insertable" on public.account_agents
  for insert with check (auth.uid() = user_id);

drop policy if exists "own agents deletable" on public.account_agents;
create policy "own agents deletable" on public.account_agents
  for delete using (auth.uid() = user_id);
