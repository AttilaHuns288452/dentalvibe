-- 0017_service_active_guard_qr.sql
-- 1) Inactive services cannot be booked — enforced in the database, not just
--    hidden in the UI (the appointment insert/update rejects them).
-- 2) Automated in-store static QR is retired: the payment config is normalized
--    to the dynamic QR path (paymongo-create also refuses qr_style='instore').

create or replace function public.fn_appt_service_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  svc_id uuid;
begin
  if new.service_id is not null then
    if exists (select 1 from public.services s where s.id = new.service_id and s.active = false) then
      raise exception 'that service is not bookable';
    end if;
  end if;
  -- multi-service bookings: every id in service_ids must be active too
  if new.service_ids is not null then
    for svc_id in select unnest(new.service_ids) loop
      if exists (select 1 from public.services s where s.id = svc_id and s.active = false) then
        raise exception 'that service is not bookable';
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_appt_service_guard on public.appointments;
create trigger trg_appt_service_guard
  before insert or update of service_id, service_ids
  on public.appointments
  for each row execute function public.fn_appt_service_guard();

update public.payment_provider_config set value = 'dynamic', updated_at = now() where key = 'qr_style';
