-- 0003_payment_workflow.sql — async external-payment lifecycle + owner QR manager.
-- Model: receipt submission is EVIDENCE (payments.status='submitted'), never payment.
-- Owner verification against the clinic's real merchant records is the only authority.
--
-- Canonical payment state machine (payments.status):
--   submitted → verified | rejected | expired
-- appointments.payment_status is a simplified projection: unpaid → submitted → verified
-- (rejected maps back to 'unpaid' so the patient can resubmit).
--
-- Two legitimate payment origins converge on `transactions`:
--   ONLINE  : patient submits evidence → owner verifies → transaction (payment_id set)
--   WALK-IN : owner/authorized staff insert transaction directly (payment_id null)

-- ── 1. payment methods (owner-configured QR destinations) ────────────────────
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                   -- provider key: GCash | Maya | BPI | ...
  display_name text not null,
  type text not null default 'ewallet' check (type in ('ewallet','bank','other','mock')),
  account_name text,
  account_number text,
  account_display text not null default 'masked'
    check (account_display in ('full','masked','hidden')),
  instructions text,
  qr_image text,                                        -- data URL (same convention as payment_proofs.image)
  active boolean not null default true,
  is_default boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- exactly one default at a time — DB-enforced, not UI convention
create unique index if not exists payment_methods_one_default
  on public.payment_methods (is_default) where is_default;

-- ── 2. payments (async lifecycle; one active submission per appointment) ─────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  -- snapshots: editing/replacing the method later must never rewrite history
  method_name_snapshot text,
  account_name_snapshot text,
  account_number_snapshot text,
  amount numeric(10,2) not null check (amount > 0),      -- authoritative: appointment price at submit
  reference_number text,
  receipt text not null check (length(receipt) between 1 and 2000000),
  status text not null default 'submitted'
    check (status in ('submitted','verified','rejected','expired')),
  reject_reason text,
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
-- patient double-submit protection at the persistence layer
create unique index if not exists payments_active_submission
  on public.payments (appointment_id) where status = 'submitted';
create index if not exists payments_status_idx on public.payments (status, submitted_at desc);

-- ── 3. transactions ← exactly one financial event per verified payment ───────
alter table public.transactions
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists payment_id uuid references public.payments(id) on delete set null,
  add column if not exists payment_method text,
  add column if not exists reference text,
  add column if not exists created_by uuid references public.profiles(id);
create unique index if not exists transactions_one_per_payment
  on public.transactions (payment_id) where payment_id is not null;

-- ── 4. audit trail (who / what / when / which record — no sensitive payloads) ─
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,                                          -- only non-sensitive extras (amounts, refs)
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
drop policy if exists "audit owner read" on public.audit_log;
create policy "audit owner read" on public.audit_log for select
  to authenticated using (fn_my_role() = 'owner');

create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'));
  return coalesce(new, old);
end $$;
-- who/what/when/which on the sensitive tables (no row payloads → no PHI in logs)
drop trigger if exists audit_patients on public.patients;
create trigger audit_patients after insert or update or delete on public.patients
  for each row execute function public.fn_audit();
drop trigger if exists audit_dentists on public.dentists;
create trigger audit_dentists after insert or update or delete on public.dentists
  for each row execute function public.fn_audit();
drop trigger if exists audit_settings on public.clinic_settings;
create trigger audit_settings after update on public.clinic_settings
  for each row execute function public.fn_audit();
drop trigger if exists audit_transactions on public.transactions;
create trigger audit_transactions after insert or update or delete on public.transactions
  for each row execute function public.fn_audit();

-- ── 5. fn_submit_payment — patient submits EVIDENCE (never verification) ─────
create or replace function public.fn_submit_payment(
  p_appointment uuid, p_method uuid, p_reference text, p_image text
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_s timestamptz; v_d int; v_amt numeric; v_id uuid; v_m record;
begin
  if p_image is null or length(p_image) = 0 then raise exception 'receipt image required'; end if;
  if length(p_image) > 2000000 then raise exception 'receipt image too large (max 2MB)'; end if;
  perform set_config('app.bypass_guard', 'on', true);

  select scheduled_at, duration_minutes, price into v_s, v_d, v_amt
    from public.appointments
   where id = p_appointment
     and status = 'pending'
     and payment_status in ('unpaid')                    -- resubmission after rejection lands here
     and exists (select 1 from public.patients pt
                  where pt.id = appointments.patient_id and pt.user_id = auth.uid());
  if v_s is null then raise exception 'appointment not payable'; end if;

  if exists (select 1 from public.payments
              where appointment_id = p_appointment and status = 'submitted') then
    raise exception 'payment already submitted and awaiting verification';
  end if;

  if p_method is not null then
    select * into v_m from public.payment_methods where id = p_method and active;
    if not found then raise exception 'payment method not available'; end if;
  end if;

  -- one chair, one day: concurrent submitters queue here before the overlap check
  perform pg_advisory_xact_lock(hashtext('chair:' || v_s::date::text)::bigint);
  -- a SUBMITTED payment holds the slot too — evidence submitted = slot reserved
  if exists (
    select 1 from public.appointments x
     where x.payment_status in ('submitted', 'verified') and x.status <> 'cancelled'
       and x.id <> p_appointment
       and x.scheduled_at < v_s + make_interval(mins => coalesce(v_d, 30))
       and v_s < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30))) then
    raise exception 'that time overlaps another booked visit';
  end if;

  insert into public.payments
    (appointment_id, payment_method_id, method_name_snapshot, account_name_snapshot,
     account_number_snapshot, amount, reference_number, receipt)
  values
    (p_appointment, p_method, v_m.display_name, v_m.account_name, v_m.account_number,
     coalesce(v_amt, 0), nullif(trim(coalesce(p_reference, '')), ''), p_image)
  returning id into v_id;

  update public.appointments set payment_status = 'submitted' where id = p_appointment;

  -- operational queue lives in Manage: tell the owner there is work to do
  insert into public.notifications(user_id, title, body, icon)
  select pr.id, 'Payment to verify', 'A patient submitted payment proof — review it in Manage → Pending Payments.', 'card'
    from public.profiles pr where pr.role = 'owner';

  insert into public.audit_log(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'SUBMIT', 'payments', v_id::text,
          jsonb_build_object('amount', coalesce(v_amt, 0), 'reference', p_reference));
  return v_id;
end $$;

-- ── 6. fn_verify_payment — OWNER ONLY, idempotent, exactly one transaction ───
create or replace function public.fn_verify_payment(p_payment uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_rec record;
begin
  if coalesce((select role from public.profiles where id = auth.uid()), '') <> 'owner' then
    raise exception 'only the owner can verify payments';
  end if;
  perform set_config('app.bypass_guard', 'on', true);
  select * into v_rec from public.payments where id = p_payment for update;
  if not found then raise exception 'payment not found'; end if;
  if v_rec.status = 'verified' then return; end if;      -- idempotent: double-click/retry safe
  if v_rec.status <> 'submitted' then
    raise exception 'payment is not awaiting verification';
  end if;

  update public.payments
     set status = 'verified', verified_at = now(), verified_by = auth.uid()
   where id = p_payment;

  update public.appointments
     set payment_status = 'verified', status = 'approved'
   where id = v_rec.appointment_id;

  -- exactly one financial event (partial unique index is the hard guarantee)
  insert into public.transactions
    (type, category, amount, patient_name, description, entry_date,
     appointment_id, payment_id, payment_method, reference, created_by)
  select 'income', 'Appointment fee', v_rec.amount, p.full_name,
         'QR payment' || coalesce(' — ' || v_rec.method_name_snapshot, ''),
         coalesce(a.scheduled_at::date, current_date),
         v_rec.appointment_id, v_rec.id, v_rec.method_name_snapshot, v_rec.reference_number, auth.uid()
    from public.appointments a
    join public.patients p on p.id = a.patient_id
   where a.id = v_rec.appointment_id
  on conflict (payment_id) where payment_id is not null do nothing;

  insert into public.audit_log(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'VERIFY', 'payments', v_rec.id::text,
          jsonb_build_object('amount', v_rec.amount, 'reference', v_rec.reference_number));
end $$;

-- ── 7. fn_reject_payment — OWNER ONLY, reason required, resubmission allowed ─
create or replace function public.fn_reject_payment(p_payment uuid, p_reason text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_rec record; v_uid uuid;
begin
  if coalesce((select role from public.profiles where id = auth.uid()), '') <> 'owner' then
    raise exception 'only the owner can reject payments';
  end if;
  if coalesce(nullif(trim(coalesce(p_reason, '')), ''), '') = '' then
    raise exception 'rejection reason required';
  end if;
  perform set_config('app.bypass_guard', 'on', true);
  select * into v_rec from public.payments where id = p_payment for update;
  if not found then raise exception 'payment not found'; end if;
  if v_rec.status = 'rejected' then return; end if;      -- idempotent
  if v_rec.status <> 'submitted' then
    raise exception 'payment is not awaiting verification';
  end if;

  update public.payments
     set status = 'rejected', reject_reason = trim(p_reason)
   where id = p_payment;

  -- projection back to unpaid → patient may resubmit (slot no longer held)
  update public.appointments
     set payment_status = 'unpaid'
   where id = v_rec.appointment_id and payment_status = 'submitted';

  select pt.user_id into v_uid from public.appointments a
    join public.patients pt on pt.id = a.patient_id where a.id = v_rec.appointment_id;
  if v_uid is not null then
    insert into public.notifications(user_id, title, body, icon)
    values (v_uid, 'Payment needs attention',
            'Your payment could not be verified: ' || trim(p_reason) ||
            ' You can resubmit your proof from My Appointments.', 'x');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'REJECT', 'payments', v_rec.id::text,
          jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ── 8. fn_payment_methods — masked account numbers for non-owners ────────────
create or replace function public.fn_payment_methods()
returns table (
  id uuid, name text, display_name text, type text, account_name text,
  account_number text, instructions text, qr_image text, is_default boolean,
  display_order integer
)
language sql stable security definer set search_path to 'public' as $$
  select m.id, m.name, m.display_name, m.type, m.account_name,
         case
           when fn_my_role() = 'owner' or m.account_display = 'full' then m.account_number
           when m.account_display = 'masked' then '•••• ' || right(coalesce(m.account_number, ''), 4)
           else null
         end as account_number,
         m.instructions, m.qr_image, m.is_default, m.display_order
    from public.payment_methods m
   where m.active or fn_my_role() = 'owner'
   order by m.is_default desc, m.display_order, m.created_at;
$$;

-- ── 9. RLS ──────────────────────────────────────────────────────────────────
alter table public.payment_methods enable row level security;
drop policy if exists "methods read" on public.payment_methods;
create policy "methods read" on public.payment_methods for select
  to authenticated using (fn_my_role() = 'owner' or active);
drop policy if exists "methods owner write" on public.payment_methods;
create policy "methods owner write" on public.payment_methods for all
  to authenticated using (fn_my_role() = 'owner') with check (fn_my_role() = 'owner');

alter table public.payments enable row level security;
drop policy if exists "payments read own or staff" on public.payments;
create policy "payments read own or staff" on public.payments for select
  to authenticated using (
    fn_my_role() in ('doctor','owner')
    or exists (select 1 from public.appointments a
                 join public.patients pt on pt.id = a.patient_id
                where a.id = payments.appointment_id and pt.user_id = auth.uid()));
-- NO patient INSERT/UPDATE policy: submissions go through fn_submit_payment only
-- (validates price, overlap, method; snapshots at submit). Owner updates via RPC too.
drop policy if exists "payments owner update" on public.payments;
create policy "payments owner update" on public.payments for update
  to authenticated using (fn_my_role() = 'owner') with check (fn_my_role() = 'owner');

-- ── 10. tighten approve rule: confirmation requires VERIFIED payment ────────
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
    -- §13: confirmation is the consequence of verification, never of submission
    if new.status = 'approved' and old.status <> 'approved'
       and new.payment_status <> 'verified' then
      raise exception 'payment must be verified before the appointment can be confirmed';
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

-- ── 11. drop the legacy auto-verify path (receipt ≠ payment) ────────────────
drop function if exists public.fn_submit_payment_proof(uuid, text);

-- ── 12. backfill: pre-migration verified appointments become ledger events ──
-- (IncomeHub derives from `transactions` alone after this — one source of truth)
insert into public.transactions
  (type, category, amount, patient_name, description, entry_date, appointment_id)
select 'income', 'Appointment fee', a.price, p.full_name, 'QR payment',
       coalesce(a.scheduled_at::date, current_date), a.id
  from public.appointments a
  join public.patients p on p.id = a.patient_id
 where a.payment_status = 'verified' and a.status <> 'cancelled'
   and coalesce(a.price, 0) > 0
   and not exists (select 1 from public.transactions t where t.appointment_id = a.id)
on conflict do nothing;

-- ── 13. seed mock payment methods (demo destinations — no real funds move) ───
insert into public.payment_methods
  (name, display_name, type, account_name, account_number, account_display, instructions, qr_image, is_default, display_order)
select * from (values
  ('GCash',   'D.A.R. Dental Clinic — GCash (Demo)',   'mock', 'D.A.R. Dental Clinic', '0917 000 0001', 'masked',
   'Scan the QR using your GCash app. Send the exact appointment fee shown above.', null, true,  1),
  ('Maya',    'D.A.R. Dental Clinic — Maya (Demo)',    'mock', 'D.A.R. Dental Clinic', '0918 000 0002', 'masked',
   'Scan the QR using your Maya app. Include your appointment reference in the payment note if supported.', null, false, 2),
  ('MariBank','D.A.R. Dental Clinic — MariBank (Demo)','mock', 'D.A.R. Dental Clinic', '1234', 'masked',
   'Transfer using your MariBank app to the account above.', null, false, 3)
) as v(name, display_name, type, account_name, account_number, account_display, instructions, qr_image, is_default, display_order)
where not exists (select 1 from public.payment_methods);
