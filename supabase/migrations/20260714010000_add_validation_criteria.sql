-- TaskMesh: make the AI validation visible on the board.
--
-- The platform already grades every submission with an LLM before the paywall
-- opens (see lib/llm.ts). That check has always happened invisibly on the
-- backend. These two columns surface it:
--
--   criteria   — the acceptance criteria derived from the task at post time,
--                shown as a checklist the moment a worker claims the task
--                ("here's what you're being judged against").
--   validation — the per-criterion pass/fail breakdown the validator produces
--                at submission time, shown as a checked-off list that gates the
--                "Pay & unlock" button.
--
-- Both are safe to expose on the public board: neither contains the paywalled
-- result text (that lives in task_results — see the 20260714000000 migration).
-- The validator is instructed to write reasoning that never reproduces the
-- summary, so the goods stay behind the 402.

alter table public.tasks
  add column if not exists criteria jsonb,
  add column if not exists validation jsonb;
