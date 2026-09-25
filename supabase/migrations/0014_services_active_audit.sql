-- 0014_services_active_audit.sql — service lifecycle + auditability.
-- services.active: inactive services stay referenced by history but cannot
-- be booked (booking filters them). Audit triggers on the money/settings
-- tables: who/what/when/which record (ids only — no sensitive content).

alter table public.services add column if not exists active boolean not null default true;

-- fn_audit already exists (auth triggers use it); attach it where money,
-- prices, settings, and staff status change.
drop trigger if exists trg_audit_services on public.services;
create trigger trg_audit_services after insert or update or delete on public.services
  for each row execute function public.fn_audit();

drop trigger if exists trg_audit_service_prices on public.service_prices;
create trigger trg_audit_service_prices after insert or update or delete on public.service_prices
  for each row execute function public.fn_audit();

drop trigger if exists trg_audit_clinic_settings on public.clinic_settings;
create trigger trg_audit_clinic_settings after update on public.clinic_settings
  for each row execute function public.fn_audit();

drop trigger if exists trg_audit_dentists on public.dentists;
create trigger trg_audit_dentists after insert or update or delete on public.dentists
  for each row execute function public.fn_audit();
