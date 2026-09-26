-- 0026_processed_semantics.sql — provider_events.processed_at historically meant
-- 'received at' (NOT NULL DEFAULT now()). For webhook retry correctness it must
-- mean PROCESSED: nullable, no auto-stamp. Old stamps cleared — re-processing an
-- already-settled event is an idempotent no-op (settle + notification dedupe).
-- Also replaces the stale receipt-upload wording in the visit-complete notice.
alter table public.provider_events alter column processed_at drop default;
alter table public.provider_events alter column processed_at drop not null;
update public.provider_events set processed_at = null;
-- (fn_notify_patient re-created with 'Your visit is complete — thank you for visiting.')
