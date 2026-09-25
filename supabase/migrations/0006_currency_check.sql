-- 0006_currency_check.sql — amount + currency verification at settlement.
-- fn_apply_payment_result gains p_currency (default null = any). 'paid' now
-- requires the provider-reported currency to be PHP. 5-arg overload dropped in 0008.
create or replace function public.fn_apply_payment_result(
  p_payment uuid,
  p_result text,
  p_provider_status text default null,
  p_failure text default null,
  p_amount_centavos bigint default null,
  p_currency text default null
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
