-- 0015_appt_overlap_guard.sql — the database owns the slot invariant.
-- A pending payment or a paid appointment RESERVES its slot: no booking
-- (insert/update) may overlap such a reservation, regardless of who writes.
-- Unpaid appointments do not hold slots (released on expiry/cancel) — the
-- deterministic winner is decided at payment time (fn_set_payment_projection).
-- The authoritative settle path (fn_apply_payment_result) sets
-- app.bypass_guard and handles slot conflicts itself (appointment stays
-- unapproved + reschedule notice) so a late payment can never throw mid-settle.

create or replace function public.fn_appt_overlap_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'cancelled' then return new; end if;
  if current_setting('app.bypass_guard', true) = 'on' then return new; end if;
  if exists (
    select 1 from public.appointments x
     where x.id <> new.id
       and x.status <> 'cancelled'
       and x.payment_status in ('pending', 'paid')
       and x.scheduled_at < new.scheduled_at + make_interval(mins => coalesce(new.duration_minutes, 30))
       and new.scheduled_at < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30))
  ) then
    raise exception 'that time overlaps another booked visit';
  end if;
  return new;
end $$;

drop trigger if exists trg_appt_overlap on public.appointments;
create trigger trg_appt_overlap
  before insert or update of scheduled_at, duration_minutes, status, payment_status
  on public.appointments
  for each row execute function public.fn_appt_overlap_guard();
