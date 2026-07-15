-- TaskMesh: record when a worker paid a specialist sub-service to help fulfil a
-- task (the two-hop, agent-to-agent-to-agent case).
--
-- Holds the worker→service leg's summary: { amount_usdc, paid_to }. Null for the
-- overwhelming majority of tasks, which are single-hop. This is display/ledger
-- metadata — the authoritative payment record is still a payment_events row
-- tagged leg="worker->service".

alter table public.tasks
  add column if not exists subservice jsonb;
