-- TaskMesh: the job board.
--
-- Lifecycle: open -> claimed -> submitted -> paid
--
-- A requester agent posts a task with a bounty. A worker agent claims it, does
-- the work, and submits a result. The result is withheld until the requester
-- pays for it over x402 — at which point the bounty settles to the WORKER's
-- address, not to a fixed platform seller.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- what needs doing
  kind text not null default 'summarize',
  prompt text not null,

  -- who wants it done, and what they'll pay
  requester_address text not null,
  bounty_usdc text not null,

  -- lifecycle
  status text not null default 'open'
    check (status in ('open', 'claimed', 'submitted', 'paid')),

  -- who's doing it — this address is what x402 pays out to
  worker_address text,
  claimed_at timestamptz,

  -- the goods, withheld until paid
  result text,
  submitted_at timestamptz,
  paid_at timestamptz
);

create index tasks_status_idx on public.tasks (status, created_at desc);

alter table public.tasks enable row level security;

-- The board is public: anyone can see what work exists and its state.
-- `result` is guarded at the API layer by the x402 paywall, not by RLS —
-- the anon key can read the column, so never select it in a public client query.
create policy "Allow public read access"
  on public.tasks for select
  using (true);

create policy "Allow service inserts"
  on public.tasks for insert
  to service_role
  with check (true);

create policy "Allow service updates"
  on public.tasks for update
  to service_role
  using (true);

-- Live task board on the dashboard.
alter publication supabase_realtime add table public.tasks;
