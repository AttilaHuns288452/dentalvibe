-- 0004_paymongo.sql — payment provider switch: PayMongo dynamic QR Ph replaces the
-- manual clinic-QR / owner-verification workflow (0003).
--
-- Authority model: the PayMongo webhook (signature-verified, idempotent per event)
-- is the ONLY thing that marks a payment paid. Receipts and patient claims never are.
-- One internal payment record per appointment attempt, linked to the PayMongo
-- PaymentIntent; one transaction per paid payment (unique index on payment_id).
--
-- payments.status: pending → paid | failed | expired | cancelled
-- appointments.payment_status (projection): unpaid → pending → paid
--   (failed/expired payments project back to 'unpaid' so the patient can retry)

-- ── 1. drop the manual QR Manager + manual verification path ────────────────
drop function if exists public.fn_submit_payment(uuid, uuid, text, text);
drop function if exists public.fn_verify_payment(uuid);
drop function if exists public.fn_reject_payment(uuid, text);
drop function if exists public.fn_payment_methods();
drop table if exists public.payment_methods cascade;

-- ── 2. rework payments into the provider model ──────────────────────────────
alter table public.payments
  drop column if exists payment_method_id,
  drop column if exists method_name_snapshot,
  drop column if exists account_name_snapshot,
  drop column if exists account_number_snapshot,
  drop column if exists reference_number,
  drop column if exists receipt,
  drop column if exists reject_reason,
  drop column if exists verified_at,
  drop column if exists verified_by;

alter table public.payments
  add column if not exists provider text not null default 'paymongo',
  add column if not exists payment_intent_id text,
  add column if not exists client_key text,
  add column if not exists qr_image text,          -- provider-rendered QR (base64 data URL)
  add column if not exists qr_payload text,        -- raw payload (mock/dev rendering)
  add column if not exists provider_status text,
  add column if not exists failure_reason text,
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending','paid','failed','expired','cancelled'));

drop index if exists payments_active_submission;
create unique index if not exists payments_active_pending
  on public.payments (appointment_id) where status = 'pending';
create unique index if not exists payments_intent_unique
  on public.payments (payment_intent_id) where payment_intent_id is not null;

-- ── 3. webhook event ledger — duplicate delivery is a no-op, not a double ───
create table if not exists public.provider_events (
  event_id text primary key,
  event_type text not null,
  payment_id uuid references public.payments(id) on delete set null,
  payload jsonb,
  processed_at timestamptz not null default now()
);

-- ── 4. provider secrets — server-side only (edge functions, service role) ───
-- RLS enabled with NO policies: neither anon nor authenticated can read it.
create table if not exists public.payment_provider_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.payment_provider_config enable row level security;

-- ── 4b. projection setter — payment state changes are RPC-only ──────────────
-- reserving ('pending') takes the per-day advisory lock and rejects overlaps:
-- a pending payment RESERVES the slot, so two patients cannot pay for one chair.
create or replace function public.fn_set_payment_projection(
  p_appointment uuid, p_status text
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_s timestamptz; v_d int;
begin
  if p_status not in ('unpaid','pending','paid') then
    raise exception 'invalid payment projection';
  end if;
  perform set_config('app.bypass_guard', 'on', true);

  if p_status = 'pending' then
    select scheduled_at, duration_minutes into v_s, v_d
      from public.appointments where id = p_appointment and status = 'pending';
    if v_s is null then raise exception 'appointment not reservable'; end if;
    perform pg_advisory_xact_lock(hashtext('chair:' || v_s::date::text)::bigint);
    if exists (
      select 1 from public.appointments x
       where x.payment_status in ('pending', 'paid') and x.status <> 'cancelled'
         and x.id <> p_appointment
         and x.scheduled_at < v_s + make_interval(mins => coalesce(v_d, 30))
         and v_s < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30))) then
      raise exception 'that time overlaps another booked visit';
    end if;
  end if;

  update public.appointments set payment_status = p_status where id = p_appointment;
end $$;

-- transitions happen only through fn_apply_payment_result / fn_set_payment_projection
drop policy if exists "payments owner update" on public.payments;

-- ── 5. fn_apply_payment_result — the single authoritative transition ────────
-- Idempotent: replayed webhooks / repeated reconciliation cannot double-fire.
-- Re-verifies the provider-reported amount before any money state changes.
create or replace function public.fn_apply_payment_result(
  p_payment uuid,
  p_result text,            -- paid | failed | expired | cancelled
  p_provider_status text default null,
  p_failure text default null,
  p_amount_centavos bigint default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_rec record;
  v_uid uuid;
  v_conf boolean;
begin
  if p_result not in ('paid','failed','expired','cancelled') then
    raise exception 'invalid payment result';
  end if;
  perform set_config('app.bypass_guard', 'on', true);
  select * into v_rec from public.payments where id = p_payment for update;
  if not found then raise exception 'payment not found'; end if;

  if v_rec.status = p_result then return; end if;          -- replay: already applied
  if v_rec.status = 'paid' then
    raise exception 'payment already settled';              -- paid is terminal
  end if;

  if p_result = 'paid' then
    -- verify expected amount before marking paid (centavos)
    if p_amount_centavos is not null
       and p_amount_centavos <> round(v_rec.amount * 100)::bigint then
      raise exception 'payment amount mismatch';
    end if;
    update public.payments
       set status = 'paid', paid_at = now(),
           provider_status = coalesce(p_provider_status, 'succeeded'),
           failure_reason = null
     where id = p_payment;
    -- confirm ONLY if the slot is still free (a late webhook after an expiry
    -- release must not resurrect a double-booked slot — money is still recorded)
    select not exists (
      select 1 from public.appointments x
       where x.payment_status in ('pending', 'paid') and x.status <> 'cancelled'
         and x.id <> v_rec.appointment_id
         and x.scheduled_at < (select scheduled_at from public.appointments where id = v_rec.appointment_id)
              + make_interval(mins => coalesce((select duration_minutes from public.appointments where id = v_rec.appointment_id), 30))
         and (select scheduled_at from public.appointments where id = v_rec.appointment_id)
              < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30)))
      into v_conf;
    update public.appointments
       set payment_status = 'paid',
           status = case when v_conf then 'approved' else status end
     where id = v_rec.appointment_id and status = 'pending';
    -- exactly one financial event (partial unique index on payment_id)
    insert into public.transactions
      (type, category, amount, patient_name, description, entry_date,
       appointment_id, payment_id, payment_method, reference, created_by)
    select 'income', 'Appointment fee', v_rec.amount, p.full_name,
           case when v_conf then 'QR payment — PayMongo'
                else 'QR payment — PayMongo (slot conflict: needs reschedule)' end,
           coalesce(a.scheduled_at::date, current_date),
           v_rec.appointment_id, v_rec.id, 'PayMongo', v_rec.payment_intent_id, null
      from public.appointments a
      join public.patients p on p.id = a.patient_id
     where a.id = v_rec.appointment_id
    on conflict (payment_id) where payment_id is not null do nothing;
    select pt.user_id into v_uid from public.appointments a
      join public.patients pt on pt.id = a.patient_id where a.id = v_rec.appointment_id;
    if v_uid is not null then
      insert into public.notifications(user_id, title, body, icon)
      values (v_uid, 'Payment confirmed',
              case when v_conf
                   then 'Your payment was received and your appointment is confirmed — arrive 10 minutes early.'
                   else 'Your payment was received. The time slot needs rescheduling — the clinic will contact you.' end,
              'check');
    end if;
  else
    update public.payments
       set status = p_result,
           provider_status = coalesce(p_provider_status, p_result),
           failure_reason = coalesce(p_failure, p_result)
     where id = p_payment;
    -- release the projection so the patient can retry
    update public.appointments
       set payment_status = 'unpaid'
     where id = v_rec.appointment_id and payment_status = 'pending';
    select pt.user_id into v_uid from public.appointments a
      join public.patients pt on pt.id = a.patient_id where a.id = v_rec.appointment_id;
    if v_uid is not null then
      insert into public.notifications(user_id, title, body, icon)
      values (v_uid, 'Payment ' || p_result,
              case when p_result = 'expired'
                   then 'Your QR payment code expired. You can generate a new one from My Appointments.'
                   else 'Your payment did not go through. You can try again from My Appointments.' end,
              'x');
    end if;
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, detail)
  values (null, 'PAYMENT_' || upper(p_result), 'payments', p_payment::text,
          jsonb_build_object('provider_status', coalesce(p_provider_status, p_result)));
end $$;

-- ── 6. approval requires a SETTLED payment (webhook-verified) ───────────────
create or replace function public.fn_appointment_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_role text; v_exp numeric; v_dur int;
begin
  if auth.uid() is null then return new; end if;
  if current_setting('app.bypass_guard', true) = 'on' then return new; end if;
  select role into v_role from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if v_role in ('doctor','owner') then return new; end if;
    if new.status <> 'pending' or new.payment_status <> 'unpaid' then
      raise exception 'appointments start as pending and unpaid';
    end if;
    select coalesce(sum(coalesce(
        (select sp.price from public.service_prices sp where sp.patient_id = new.patient_id and sp.service_id = sid),
        (select s.price from public.services s where s.id = sid))), 0),
           coalesce(sum(coalesce((select s2.duration_minutes from public.services s2 where s2.id = sid), 30)), 30)
      into v_exp, v_dur
      from unnest(coalesce(new.service_ids, array[new.service_id])) as sid;
    if v_exp = 0 or new.price is distinct from v_exp then
      raise exception 'price does not match the service price';
    end if;
    new.duration_minutes := v_dur;
    return new;
  end if;

  if v_role in ('doctor','owner') then
    if v_role = 'doctor' and new.payment_status is distinct from old.payment_status then
      raise exception 'payment status changes happen through payment only';
    end if;
    if new.status = 'approved' and old.status <> 'approved'
       and new.payment_status <> 'paid' then
      raise exception 'payment must be settled before the appointment can be confirmed';
    end if;
    return new;
  end if;
  if new.status = old.status and new.payment_status = old.payment_status
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.price = old.price and new.patient_id = old.patient_id
     and new.service_id = old.service_id and new.service_ids is not distinct from old.service_ids
     and new.duration_minutes = old.duration_minutes
     and new.dentist_id is not distinct from old.dentist_id
     and new.clinical_note is not distinct from old.clinical_note then
    return new;
  end if;
  if new.status = 'cancelled' and old.status = 'pending'
     and new.payment_status = old.payment_status and new.scheduled_at is not distinct from old.scheduled_at
     and new.price = old.price and new.clinical_note is not distinct from old.clinical_note then
    return new;
  end if;
  raise exception 'patients can only edit notes or cancel a pending booking';
end; $$;

-- ── 7. remap legacy payment states to the provider vocabulary ───────────────
-- order matters: old check pins the OLD vocabulary and the new check rejects it —
-- drop → remap rows → add the new check
alter table public.appointments drop constraint if exists appointments_payment_status_check;
update public.appointments set payment_status = 'pending' where payment_status = 'submitted';
update public.appointments set payment_status = 'paid'    where payment_status = 'verified';
update public.payments       set status = 'pending' where status = 'submitted';
update public.payments       set status = 'paid', paid_at = coalesce(submitted_at, now()) where status = 'verified';
alter table public.appointments add constraint appointments_payment_status_check
  check (payment_status in ('unpaid','pending','paid'));
