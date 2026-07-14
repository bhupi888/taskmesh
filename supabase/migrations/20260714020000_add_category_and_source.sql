-- TaskMesh: let the board be browsed by expertise, and show where a task's
-- text actually came from.
--
--   category — the domain of the ticket being triaged (Customer Support,
--              Billing & Payments, …). A filter dimension on the board, and the
--              flag a worker agent can specialise on (`--category`).
--
--   source   — where the task's TEXT came from, when it came from one of the
--              curated real-world examples ("Delivery dispute — Amazon Seller
--              Forums / Etsy Community"). Null for freeform typed tasks; never
--              invent one. This is what makes "these are real, not made up" a
--              claim a judge can check on screen rather than in the code.
--
-- NOTE: `source` is about the task's TEXT, not its money. The bounty on every
-- task is always TaskMesh's own demo USDC — do not reuse this column, or the
-- word "source", to describe funding. (See "Funded by:" on the board.)

alter table public.tasks
  add column if not exists category text,
  add column if not exists source text;

-- The board's default view is "open tasks, newest first", optionally narrowed to
-- one category. Without this, that filter is a full scan of every task ever.
create index if not exists tasks_status_category_created_idx
  on public.tasks (status, category, created_at desc);
