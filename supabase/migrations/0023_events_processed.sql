-- 0023_events_processed.sql — webhook retry correctness.
-- provider_events distinguishes "received" from "processed": a transient
-- reconcile failure keeps processed_at NULL, so the provider's retry of the
-- same event RE-PROCESSES instead of being mistaken for done. Only successful
-- processing stamps processed_at; later duplicates are acknowledged no-ops.
alter table public.provider_events add column if not exists processed_at timestamptz;
