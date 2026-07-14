-- TaskMesh: stop a hostile worker looping on a task it already failed.
--
-- The named limitation this closes: a rejected task goes back on the board, so
-- a worker could re-claim it, submit garbage again, and burn one LLM validation
-- call per attempt. The cost of that lands on the platform, not the attacker.
--
-- worker.mts already keeps a `rejected` Set so a WELL-BEHAVED agent backs off.
-- That is not enforcement — it's etiquette, and a hostile worker simply wouldn't
-- run our client. This table is the server-side version of the same rule.
--
-- Deliberately narrow: it blocks THIS worker from re-claiming THIS task. The
-- task stays open and claimable by everyone else, and the worker stays free to
-- claim any other task. This is not a reputation system and must not grow into
-- one here — cross-task worker scoring is ERC-8004 territory, parked as a
-- stretch goal.

create table if not exists public.task_rejections (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Checksummed (EIP-55), exactly as /claim and /submit normalise it. If this
  -- ever stores a raw lowercase address the lookup silently misses and the
  -- block does nothing — see the address-casing bug in the notes.
  worker_address text not null,
  reason text,
  rejected_at timestamptz not null default now()
);

-- One row per (task, worker): re-failing the same task shouldn't stack rows, and
-- this is the index the claim check reads.
create unique index if not exists task_rejections_task_worker_idx
  on public.task_rejections (task_id, worker_address);
