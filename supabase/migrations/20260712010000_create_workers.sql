-- Worker agents, and the Circle wallet each one earns into.
--
-- The point of this table: a worker agent joins TaskMesh by name and is issued
-- a Circle developer-controlled (MPC) wallet. Circle custodies the key. The
-- agent only ever knows an address. No private key is generated, transmitted,
-- or stored anywhere in this system.

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- how the agent identifies itself; onboarding is idempotent on this
  name text not null unique,

  -- the Circle-issued wallet it gets paid into
  circle_wallet_id text not null unique,
  address text not null unique,
  blockchain text not null default 'ARC-TESTNET'
);

alter table public.workers enable row level security;

create policy "Allow public read access"
  on public.workers for select
  using (true);

create policy "Allow service inserts"
  on public.workers for insert
  to service_role
  with check (true);

alter publication supabase_realtime add table public.workers;
