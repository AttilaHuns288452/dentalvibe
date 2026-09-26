-- 0021_dentist_capacity.sql — multi-dentist parallel capacity.
-- Capacity model (documented decision):
--   an ACTIVE dentist counts as available for a clinic date UNLESS a
--   ready=false presence row exists for that date ("Not Ready"). A ready=true
--   row makes today's state explicit ("Ready for Today"). Presence rows are
--   per clinic_date and expire with the day — never a permanent account flag.
--   Deactivated dentists never count and can never become Ready.
--   N available dentists -> N parallel appointment resources (nothing hardcoded).
-- Assignment: LEAST-LOADED available dentist (fewest non-cancelled appointments
--   that date; tie-break dentist id) that has no reserved overlap
--   (payment_status pending/paid) for the requested window. No available
--   dentist -> the booking is rejected. Enforced by a BEFORE trigger under a
--   per-clinic-day advisory lock, so concurrent bookings can never assign the
--   same dentist to overlapping reservations.

create table if not exists public.dentist_ready (
  id uuid primary key default gen_random_uuid(),
  dentist_id uuid not null references public.dentists(id) on delete cascade,
  clinic_date date not null,
  ready boolean not null,
  ready_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (dentist_id, clinic_date)
);
alter table public.dentist_ready enable row level security;
drop policy if exists "ready read all" on public.dentist_ready;
create policy "ready read all" on public.dentist_ready for select using (auth.uid() is not null);
drop policy if exists "ready own write" on public.dentist_ready;
create policy "ready own write" on public.dentist_ready for insert with check (
  exists (select 1 from public.dentists d where d.id = dentist_id and lower(d.email) = lower((select email from auth.users where id = auth.uid())))
);
drop policy if exists "ready own update" on public.dentist_ready;
create policy "ready own update" on public.dentist_ready for update using (
  exists (select 1 from public.dentists d where d.id = dentist_id and lower(d.email) = lower((select email from auth.users where id = auth.uid())))
);
drop policy if exists "ready owner write" on public.dentist_ready;
create policy "ready owner write" on public.dentist_ready for all using (public.fn_my_role() = 'owner');

-- a deactivated dentist can never become Ready
create or replace function public.fn_dentist_ready_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.dentists d where d.id = new.dentist_id and d.active) then
    raise exception 'deactivated dentist cannot become ready';
  end if;
  return new;
end $$;
drop trigger if exists trg_dentist_ready_guard on public.dentist_ready;
create trigger trg_dentist_ready_guard before insert or update on public.dentist_ready
  for each row execute function public.fn_dentist_ready_guard();

create or replace function public.fn_dentist_available(p_dentist uuid, p_date date) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.dentists d
     where d.id = p_dentist and d.active
       and not exists (select 1 from public.dentist_ready r
                        where r.dentist_id = p_dentist and r.clinic_date = p_date and r.ready = false)
  );
$$;

create or replace function public.fn_dentist_free(p_dentist uuid, p_start timestamptz, p_mins int, p_exclude uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not exists (
    select 1 from public.appointments x
     where x.dentist_id = p_dentist
       and x.id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
       and x.status <> 'cancelled'
       and x.payment_status in ('pending', 'paid')
       and x.scheduled_at < p_start + make_interval(mins => p_mins)
       and p_start < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30))
  );
$$;

-- assignment + per-dentist overlap enforcement (replaces the global guard)
create or replace function public.fn_appt_dentist_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_date date;
  v_mins int;
  v_dentist uuid;
begin
  if new.status = 'cancelled' then return new; end if;
  if current_setting('app.bypass_guard', true) = 'on' then return new; end if;
  if new.scheduled_at is null then return new; end if; -- unscheduled rows are not reservations
  v_date := (new.scheduled_at at time zone 'Asia/Manila')::date;
  v_mins := coalesce(new.duration_minutes, 30);

  -- serialize assignment for this clinic day: concurrent bookings pick distinct dentists
  perform pg_advisory_xact_lock(hashtext('dv-assign:' || v_date::text));

  if new.dentist_id is null then
    -- least-loaded available dentist with no reserved overlap (deterministic tie-break)
    select d.id into v_dentist
      from public.dentists d
     where fn_dentist_available(d.id, v_date)
       and fn_dentist_free(d.id, new.scheduled_at, v_mins, new.id)
     order by (select count(*) from public.appointments x
                where x.dentist_id = d.id and x.status <> 'cancelled'
                  and (x.scheduled_at at time zone 'Asia/Manila')::date = v_date),
              d.id
     limit 1;
    if v_dentist is null then
      raise exception 'no dentist available for that time';
    end if;
    new.dentist_id := v_dentist;
  else
    if not fn_dentist_available(new.dentist_id, v_date) then
      raise exception 'no dentist available for that time';
    end if;
    if not fn_dentist_free(new.dentist_id, new.scheduled_at, v_mins, new.id) then
      raise exception 'that time overlaps another booked visit';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_appt_overlap on public.appointments;
drop trigger if exists trg_appt_dentist_guard on public.appointments;
create trigger trg_appt_dentist_guard
  before insert or update of scheduled_at, duration_minutes, status, payment_status, dentist_id
  on public.appointments
  for each row execute function public.fn_appt_dentist_guard();

create index if not exists appointments_dentist_idx on public.appointments (dentist_id);
