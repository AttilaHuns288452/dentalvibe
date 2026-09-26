-- 0030_dentist_work_schedules.sql — planned availability vs day-of presence.
--
-- MODEL (locked): future booking capacity comes from the dentist's WORK SCHEDULE
-- (dentist_work_schedules: day-of-week + hours). The daily Ready/Not Ready state
-- (dentist_ready) is an operational day-of signal ONLY — it never enables or
-- blocks a booking. Ready drives the clinic's operational view + warnings.
--
-- A dentist with no active schedule row for a date is NOT a resource that date.
-- Deactivated dentists are never resources. Nothing about dentist counts is
-- hardcoded: N scheduled dentists = N parallel resources.

create table if not exists public.dentist_work_schedules (
  id uuid primary key default gen_random_uuid(),
  dentist_id uuid not null references public.dentists(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6), -- extract(dow): 0=Sunday
  open_time time not null,
  close_time time not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (dentist_id, day_of_week),
  check (close_time > open_time)
);

alter table public.dentist_work_schedules enable row level security;
drop policy if exists "work sched owner write" on public.dentist_work_schedules;
create policy "work sched owner write" on public.dentist_work_schedules for all
  using (public.fn_my_role() = 'owner') with check (public.fn_my_role() = 'owner');
drop policy if exists "work sched read" on public.dentist_work_schedules;
create policy "work sched read" on public.dentist_work_schedules for select
  using (public.fn_my_role() = ANY (ARRAY['doctor', 'owner']));

-- one set of schedules per active dentist on migration (clinic hours, Mon–Sat) so
-- existing capacity survives; owners then customize per dentist
insert into public.dentist_work_schedules (dentist_id, day_of_week, open_time, close_time)
select d.id, dow,
       coalesce((select open_time::time from public.clinic_settings limit 1), '10:00'::time),
       coalesce((select close_time::time from public.clinic_settings limit 1), '17:00'::time)
  from public.dentists d, generate_series(1, 6) dow
 where d.active = true
on conflict (dentist_id, day_of_week) do nothing;

-- is this dentist a working resource at this Manila wall-clock moment?
create or replace function public.fn_dentist_scheduled(p_dentist uuid, p_date date, p_start time, p_mins int)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select exists (
    select 1 from public.dentists d
      join public.dentist_work_schedules s on s.dentist_id = d.id
     where d.id = p_dentist
       and d.active = true
       and s.active = true
       and s.day_of_week = extract(dow from p_date)
       and p_start >= s.open_time
       and p_start + make_interval(mins => coalesce(p_mins, 30)) <= s.close_time
  )
$$;

-- scheduled at that moment AND no per-dentist overlap among reservations
create or replace function public.fn_dentist_free(p_dentist uuid, p_start timestamptz, p_mins int, p_exclude uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.fn_dentist_scheduled(
       p_dentist,
       (p_start at time zone 'Asia/Manila')::date,
       (p_start at time zone 'Asia/Manila')::time,
       p_mins) then
    return false;
  end if;
  return not exists (
    select 1 from public.appointments x
     where x.dentist_id = p_dentist
       and x.payment_status in ('pending', 'paid')
       and x.status <> 'cancelled'
       and x.id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
       and tstzrange(x.scheduled_at, x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30)))
           && tstzrange(p_start, p_start + make_interval(mins => coalesce(p_mins, 30)))
  );
end
$$;

-- the guard: per-dentist overlap + auto-assignment of the LEAST-LOADED scheduled
-- dentist (tie-break dentist id). Ready-state is intentionally NOT consulted.
create or replace function public.fn_appt_dentist_guard() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_date date;
  v_start time;
  v_mins int;
  v_dentist uuid;
begin
  if tg_op = 'UPDATE'
     and new.dentist_id is not distinct from old.dentist_id
     and new.scheduled_at = old.scheduled_at
     and coalesce(new.duration_minutes, 30) = coalesce(old.duration_minutes, 30)
     and new.status = old.status and new.payment_status = old.payment_status then
    return new;
  end if;
  if new.status = 'cancelled' or new.payment_status = 'unpaid' then
    return new;
  end if;

  v_date  := (new.scheduled_at at time zone 'Asia/Manila')::date;
  v_start := (new.scheduled_at at time zone 'Asia/Manila')::time;
  v_mins  := coalesce(new.duration_minutes, 30);

  perform pg_advisory_xact_lock(hashtext('dv-assign:' || v_date::text));

  if new.dentist_id is null then
    select d.id into v_dentist
      from public.dentists d
     where public.fn_dentist_free(d.id, new.scheduled_at, v_mins, null)
     order by (
       select count(*) from public.appointments x
        where x.dentist_id = d.id
          and x.payment_status in ('pending', 'paid')
          and x.status <> 'cancelled'
          and x.scheduled_at >= date_trunc('month', new.scheduled_at)
     ), d.id
     limit 1;

    if v_dentist is null then
      raise exception 'no dentist available for that time';
    end if;
    new.dentist_id := v_dentist;
    return new;
  end if;

  if not public.fn_dentist_scheduled(new.dentist_id, v_date, v_start, v_mins) then
    raise exception 'no dentist available for that time';
  end if;
  if not public.fn_dentist_free(new.dentist_id, new.scheduled_at, v_mins, new.id) then
    raise exception 'that time overlaps another booked visit';
  end if;
  return new;
end
$$;

drop trigger if exists appt_dentist_guard on public.appointments;
create trigger appt_dentist_guard before insert or update on public.appointments
for each row execute function public.fn_appt_dentist_guard();

-- ready-state: day-of presence only. A deactivated dentist can never become Ready.
create or replace function public.fn_dentist_ready_guard() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.dentists d where d.id = new.dentist_id and d.active = false) then
    raise exception 'deactivated dentist cannot become ready';
  end if;
  new.updated_at := now();
  if new.ready then
    new.ready_at := now();
  end if;
  return new;
end
$$;

-- UI surface for patients: scheduled dentist ids + working hours for a clinic date
-- (no names/emails — patients must not read dentist rows).
create or replace function public.fn_available_dentist_ids(p_date date)
returns setof uuid
language sql
security definer
set search_path to 'public'
stable
as $$
  select d.id from public.dentists d
   where d.active = true
     and exists (select 1 from public.dentist_work_schedules s
                  where s.dentist_id = d.id and s.active = true
                    and s.day_of_week = extract(dow from p_date))
   order by d.id
$$;

create or replace function public.fn_day_schedule(p_date date)
returns table (dentist_id uuid, open_time time, close_time time)
language sql
security definer
set search_path to 'public'
stable
as $$
  select s.dentist_id, s.open_time, s.close_time
    from public.dentist_work_schedules s
    join public.dentists d on d.id = s.dentist_id
   where d.active = true and s.active = true
     and s.day_of_week = extract(dow from p_date)
   order by s.dentist_id
$$;

revoke all on function public.fn_available_dentist_ids(date) from public;
grant execute on function public.fn_available_dentist_ids(date) to authenticated;
revoke all on function public.fn_day_schedule(date) from public;
grant execute on function public.fn_day_schedule(date) to authenticated;

-- fn_dentist_available is superseded by fn_dentist_scheduled
drop function if exists public.fn_dentist_available(uuid, date);
