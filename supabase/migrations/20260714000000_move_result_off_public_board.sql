-- TaskMesh: move the paywalled goods out of the public board.
--
-- The bug this fixes: `public.tasks` is world-readable by design (the board is
-- public, and the browser subscribes to it with the anon key). RLS is ROW-level,
-- not column-level, so the `result` column — the finished work that x402 is
-- supposed to gate — was readable by the anon key too, over both PostgREST and
-- the realtime channel (tasks is in the supabase_realtime publication). That
-- defeats the paywall: anyone could read a `submitted` task's result without
-- paying.
--
-- The fix: the goods live in their own table that the anon role has no policy
-- on. It is unreadable over REST (RLS denies it) and never appears in a realtime
-- payload (it is not in the publication). Only the service role — used by the
-- server API routes behind the x402 check — can read or write it.

create table public.task_results (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  result text not null,
  created_at timestamptz not null default now()
);

alter table public.task_results enable row level security;

-- Only the service role (the server routes) may touch results. No anon or
-- authenticated policy exists, so RLS denies every browser client by default.
create policy "Service role manages task results"
  on public.task_results for all
  to service_role
  using (true)
  with check (true);

-- Defence in depth: even with RLS on, don't hand the anon/authenticated roles
-- table privileges on the goods at all.
revoke all on public.task_results from anon, authenticated;

-- Move any results that already exist over to the new table, then drop the
-- leaky column so the goods live in exactly one place.
insert into public.task_results (task_id, result)
  select id, result from public.tasks where result is not null
  on conflict (task_id) do nothing;

alter table public.tasks drop column result;
