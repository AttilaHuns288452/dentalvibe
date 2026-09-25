-- 0018_push_notifications.sql — real Web Push on the existing PWA stack.
-- Architecture: business event → persistent notification row (source of truth)
-- → AFTER INSERT trigger queues a push dispatch (pg_net, fire-and-forget) →
-- Edge Function sends Web Push to the user's active device subscriptions.
-- Push failure can NEVER affect the business transaction: the trigger only
-- queues an HTTP request and returns NEW unconditionally.

create extension if not exists pg_net with schema extensions;

-- ── 1) push subscriptions — one row PER DEVICE per user ─────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  revoked_at timestamptz
);
create index if not exists push_subscriptions_user_active
  on public.push_subscriptions (user_id) where revoked_at is null;

alter table public.push_subscriptions enable row level security;
drop policy if exists "push sub own select" on public.push_subscriptions;
create policy "push sub own select" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "push sub own insert" on public.push_subscriptions;
create policy "push sub own insert" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "push sub own update" on public.push_subscriptions;
create policy "push sub own update" on public.push_subscriptions for update using (user_id = auth.uid());
drop policy if exists "push sub own delete" on public.push_subscriptions;
create policy "push sub own delete" on public.push_subscriptions for delete using (user_id = auth.uid());

-- ── 2) server-only config (VAPID private key, internal dispatch secret) ────
-- RLS enabled with NO policies = only the service role can read it.
create table if not exists public.service_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.service_config enable row level security;

-- ── 3) notifications: deterministic event ids + deep-link routes ───────────
alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists route text;
create unique index if not exists notifications_dedupe_key
  on public.notifications (dedupe_key) where dedupe_key is not null;

-- ── 4) push dispatch trigger — queued, never blocks business logic ─────────
create or replace function public.fn_push_dispatch() returns trigger
language plpgsql security definer set search_path to 'public, extensions' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from public.service_config where key = 'push_dispatch_url';
  select value into v_secret from public.service_config where key = 'push_internal_secret';
  if v_url is not null and v_secret is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := jsonb_build_object('notification_id', new.id)
    );
  end if;
  return new; -- push delivery is secondary: never raise, never roll back
exception when others then
  return new;
end $$;

drop trigger if exists trg_push_dispatch on public.notifications;
create trigger trg_push_dispatch
  after insert on public.notifications
  for each row execute function public.fn_push_dispatch();

-- ── 5) notification helper — idempotent per dedupe_key ─────────────────────
create or replace function public.fn_notify(
  p_user uuid, p_title text, p_body text, p_icon text, p_route text, p_dedupe text
) returns void
language sql security definer set search_path to 'public' as $$
  insert into public.notifications(user_id, title, body, icon, route, dedupe_key)
  values (p_user, p_title, p_body, p_icon, p_route, p_dedupe)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
$$;

-- ── 6) fn_notify_patient v2 — patient rows keep prior behavior (+ keys and
--       routes); staff (doctors + owners) now get the important events too ──
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
    perform fn_notify(v_uid, v_title, v_body, v_icon, '/appointments',
      'appt:' || new.id || ':' || v_event || ':patient');
  end if;
  -- staff: doctors + owners get booking / confirmation / cancellation
  if v_event in ('booked', 'confirmed', 'cancelled') then
    for v_staff in select id, role from public.profiles where role in ('doctor', 'owner') loop
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

-- ── 7) message events → notifications (privacy-safe body, no message text) ─
create or replace function public.fn_notify_message() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_staff record;
begin
  if new.sender = 'patient' then
    for v_staff in select id, role from public.profiles where role in ('doctor', 'owner') loop
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

drop trigger if exists trg_message_notify on public.chat_messages;
create trigger trg_message_notify
  after insert on public.chat_messages
  for each row execute function public.fn_notify_message();
