-- 0020_deactivated_staff_notifications.sql — a deactivated doctor must not
-- receive notifications or pushes (§7). One guard at the source: the staff
-- recipient loops skip accounts whose dentists row is explicitly inactive.
-- Owners (no dentists row) are unaffected. Rows already delivered stay as
-- history; no new ones are created while deactivated.

create or replace function public.fn_notify_patient() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_title text; v_body text; v_icon text; v_event text; v_staff record;
begin
  select user_id into v_uid from public.patients where id = new.patient_id;
  if tg_op = 'INSERT' then
    v_title := 'Appointment booked';
    v_body := 'Pay to confirm your slot — ' || coalesce((select name from public.services where id = new.service_id), 'Service') || ' · ' || coalesce(new.requested_date::text, '');
    v_icon := 'clock'; v_event := 'booked';
  elsif new.status = 'approved' and old.status <> 'approved' then
    v_title := 'Appointment Confirmed';
    v_body := 'Your dental appointment on ' || coalesce(new.requested_date::text, '') || ' is confirmed — arrive 10 minutes early.';
    v_icon := 'check'; v_event := 'confirmed';
  elsif new.status = 'completed' and old.status <> 'completed' then
    v_title := 'Visit complete';
    v_body := 'Your visit is complete — receipt available in your appointments.';
    v_icon := 'card'; v_event := 'completed';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    v_title := 'Appointment cancelled';
    v_body := 'Your appointment was cancelled. You can book a new schedule anytime.';
    v_icon := 'x'; v_event := 'cancelled';
  else
    return new;
  end if;
  if v_uid is not null then
    perform fn_notify(v_uid, v_title, v_body, v_icon, '/appointments?appt=' || new.id,
      'appt:' || new.id || ':' || v_event || ':patient');
  end if;
  if v_event in ('booked', 'confirmed', 'cancelled') then
    for v_staff in
      select p.id, p.role from public.profiles p
       where p.role in ('doctor', 'owner')
         and p.id not in (select au.id from auth.users au
                            join public.dentists d on lower(d.email) = lower(au.email)
                           where d.active = false)
    loop
      perform fn_notify(v_staff.id,
        case v_event when 'booked' then 'New appointment' when 'confirmed' then 'Appointment confirmed' else 'Appointment cancelled' end,
        coalesce((select full_name from public.patients where id = new.patient_id), 'A patient') ||
          ' · ' || coalesce((select name from public.services where id = new.service_id), 'Service') ||
          ' · ' || coalesce(new.requested_date::text, ''),
        'cal',
        case when v_staff.role = 'doctor' then '/doctor/calendar' else '/owner/calendar' end,
        'appt:' || new.id || ':' || v_event || ':staff:' || v_staff.id);
    end loop;
  end if;
  return new;
end $$;

create or replace function public.fn_notify_message() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_staff record;
begin
  if new.sender = 'patient' then
    for v_staff in
      select p.id, p.role from public.profiles p
       where p.role in ('doctor', 'owner')
         and p.id not in (select au.id from auth.users au
                            join public.dentists d on lower(d.email) = lower(au.email)
                           where d.active = false)
    loop
      perform fn_notify(v_staff.id, 'New message',
        coalesce((select full_name from public.patients where id = new.patient_id), 'A patient') || ' sent you a message.',
        'chat',
        case when v_staff.role = 'doctor' then '/doctor/messages' else '/messages' end,
        'msg:' || new.id || ':staff:' || v_staff.id);
    end loop;
  else
    select user_id into v_uid from public.patients where id = new.patient_id;
    if v_uid is not null then
      perform fn_notify(v_uid, 'New message', 'The clinic sent you a new message.', 'chat', '/messages',
        'msg:' || new.id || ':patient');
    end if;
  end if;
  return new;
end $$;
