-- 0038_correct_idempotent.sql — crash-retry guard for corrections.
-- "Server mutation succeeded, client died before the response handler": the
-- user retries the same correction. Applying it twice would double-write the
-- audit trail; a correction to the SAME amount is a semantic no-op.
create or replace function public.fn_correct_transaction(p_tx uuid, p_new_amount numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tx public.transactions%rowtype; v_old numeric;
begin
  if public.fn_my_role() is distinct from 'owner' then
    raise exception 'not authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'correction reason required';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  select * into v_tx from public.transactions where id = p_tx;
  if not found then
    raise exception 'transaction not found';
  end if;
  if v_tx.voided_at is not null then
    raise exception 'transaction is voided';
  end if;
  if v_tx.amount = p_new_amount then
    return; -- crash-retry: same-amount correction must not double-apply
  end if;
  v_old := v_tx.amount;
  update public.transactions
     set amount = p_new_amount,
         correction_reason = trim(p_reason),
         updated_at = now()
   where id = p_tx;
  perform public.fn_audit_reason('CORRECT', 'transactions', p_tx::text, jsonb_build_object('amount', v_old), jsonb_build_object('amount', p_new_amount), trim(p_reason));
end $$;
