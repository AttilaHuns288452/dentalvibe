-- 0025_per_dentist_conflict.sql — the money paths scope slot conflicts to the
-- assigned dentist (parallel capacity: two ready dentists may overlap in time).

create or replace function public.fn_apply_payment_result(p_payment uuid, p_result text, p_provider_status text DEFAULT NULL::text, p_failure text DEFAULT NULL::text, p_amount_centavos bigint DEFAULT NULL::bigint, p_currency text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_rec.status = p_result then return; end if;
  if v_rec.status = 'paid' then
    raise exception 'payment already settled';
  end if;

  if p_result = 'paid' then
    if p_amount_centavos is not null
       and p_amount_centavos <> round(v_rec.amount * 100)::bigint then
      raise exception 'payment amount mismatch';
    end if;
    if p_currency is not null and upper(p_currency) <> 'PHP' then
      raise exception 'payment currency mismatch';
    end if;
    update public.payments
       set status = 'paid', paid_at = now(),
           provider_status = coalesce(p_provider_status, 'succeeded'),
           failure_reason = null
     where id = p_payment;

    select not exists (
      select 1 from public.appointments x
       where x.payment_status in ('pending', 'paid') and x.status <> 'cancelled'
         and x.id <> v_rec.appointment_id
         and x.dentist_id = (select z.dentist_id from public.appointments z where z.id = v_rec.appointment_id)
         and x.scheduled_at < (select scheduled_at from public.appointments where id = v_rec.appointment_id)
              + make_interval(mins => coalesce((select duration_minutes from public.appointments where id = v_rec.appointment_id), 30))
         and (select scheduled_at from public.appointments where id = v_rec.appointment_id)
              < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30)))
      into v_conf;
    update public.appointments
       set payment_status = 'paid',
           status = case when v_conf then 'approved' else status end
     where id = v_rec.appointment_id and status = 'pending';

    insert into public.transactions
      (type, category, amount, patient_name, description, entry_date,
       appointment_id, payment_id, payment_method, reference, created_by)
    select 'income', 'Service payment', v_rec.amount, p.full_name,
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
      perform fn_notify(v_uid, 'Payment confirmed',
              case when v_conf
                   then 'Your payment was received and your appointment is confirmed — arrive 10 minutes early.'
                   else 'Your payment was received. The time slot needs rescheduling — the clinic will contact you.' end,
              'check',
              '/appointments?appt=' || v_rec.appointment_id,
              'payment:' || p_payment || ':paid');
    end if;
  else
    update public.payments
       set status = p_result,
           provider_status = coalesce(p_provider_status, p_result),
           failure_reason = coalesce(p_failure, p_result)
     where id = p_payment;
    update public.appointments
       set payment_status = 'unpaid'
     where id = v_rec.appointment_id and payment_status = 'pending';
    select pt.user_id into v_uid from public.appointments a
      join public.patients pt on pt.id = a.patient_id where a.id = v_rec.appointment_id;
    if v_uid is not null then
      perform fn_notify(v_uid, 'Payment ' || p_result,
              case when p_result = 'expired'
                   then 'Your QR payment code expired. You can generate a new one from My Appointments.'
                   else 'Your payment did not go through. You can try again from My Appointments.' end,
              'x',
              '/appointments?appt=' || v_rec.appointment_id,
              'payment:' || p_payment || ':' || p_result);
    end if;
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, detail)
  values (null, 'PAYMENT_' || upper(p_result), 'payments', p_payment::text,
          jsonb_build_object('provider_status', coalesce(p_provider_status, p_result)));
end $function$;


create or replace function public.fn_set_payment_projection(p_appointment uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s timestamptz; v_d int; v_den uuid;
begin
  if p_status not in ('unpaid','pending','paid') then
    raise exception 'invalid payment projection';
  end if;
  perform set_config('app.bypass_guard', 'on', true);

  if p_status = 'pending' then
    select scheduled_at, duration_minutes, dentist_id into v_s, v_d, v_den
      from public.appointments where id = p_appointment and status = 'pending';
    if v_s is null then raise exception 'appointment not reservable'; end if;
    -- serialize concurrent payment attempts per clinic day
    perform pg_advisory_xact_lock(hashtext('chair:' || v_s::date::text)::bigint);
    -- a pending payment RESERVES one dentist resource; same-dentist overlaps rejected
    if exists (
      select 1 from public.appointments x
       where x.payment_status in ('pending', 'paid') and x.status <> 'cancelled'
         and x.id <> p_appointment
         and x.dentist_id = v_den
         and x.scheduled_at < v_s + make_interval(mins => coalesce(v_d, 30))
         and v_s < x.scheduled_at + make_interval(mins => coalesce(x.duration_minutes, 30))) then
      raise exception 'that time overlaps another booked visit';
    end if;
  end if;

  update public.appointments set payment_status = p_status where id = p_appointment;
end $function$;

