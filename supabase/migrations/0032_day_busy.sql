-- 0032_day_busy.sql — patients can only read their own appointment rows (RLS,
-- correct), so the booking page's busy computation saw only its own bookings and
-- over-offered slots. Expose identity-free busy intervals for a clinic date.
create or replace function public.fn_day_busy(p_date date)
returns table (dentist_id uuid, start_at timestamptz, mins int)
language sql
security definer
set search_path to 'public'
stable
as $$
  select x.dentist_id, x.scheduled_at, coalesce(x.duration_minutes, 30)
    from public.appointments x
   where x.dentist_id is not null
     and x.payment_status in ('pending', 'paid')
     and x.status <> 'cancelled'
     and (x.scheduled_at at time zone 'Asia/Manila')::date = p_date
$$;
revoke all on function public.fn_day_busy(date) from public;
grant execute on function public.fn_day_busy(date) to authenticated;
