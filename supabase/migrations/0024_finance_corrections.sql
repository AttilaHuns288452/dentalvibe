-- 0024_finance_corrections.sql — Create → Review → Correct/Void → Audit.
-- Model: controlled edit (amount + mandatory reason) or Void (timestamped,
-- excluded from income totals) — never a silent hard-delete. Appointment-linked
-- payment transactions keep their payment linkage; corrections are audited with
-- before→after by fn_audit. Owner-only mutation (RLS).

alter table public.transactions add column if not exists voided_at timestamptz;
alter table public.transactions add column if not exists correction_reason text;
alter table public.transactions add column if not exists updated_at timestamptz default now();

-- owner-only updates (insert policy already exists for walk-ins; payments insert
-- via the security-definer settlement path)
drop policy if exists "transactions owner update" on public.transactions;
create policy "transactions owner update" on public.transactions for update
  using (public.fn_my_role() = 'owner') with check (public.fn_my_role() = 'owner');
drop policy if exists "transactions owner delete" on public.transactions;
create policy "transactions owner delete" on public.transactions for delete
  using (public.fn_my_role() = 'owner');

-- corrections validate the amount and stamp the audit trail with the reason
create or replace function public.fn_correct_transaction(p_tx uuid, p_new_amount numeric, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_old record;
begin
  if public.fn_my_role() <> 'owner' then raise exception 'not authorized'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'correction reason required'; end if;
  if p_new_amount is null or p_new_amount <= 0 then raise exception 'invalid amount'; end if;
  select * into v_old from public.transactions where id = p_tx for update;
  if not found then raise exception 'transaction not found'; end if;
  if v_old.voided_at is not null then raise exception 'transaction is voided'; end if;
  update public.transactions
     set amount = p_new_amount, correction_reason = trim(p_reason), updated_at = now()
   where id = p_tx;
  perform public.fn_audit_reason('CORRECT', 'transactions', p_tx::text,
    jsonb_build_object('amount', v_old.amount),
    jsonb_build_object('amount', p_new_amount), trim(p_reason));
end $$;

create or replace function public.fn_void_transaction(p_tx uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_old record;
begin
  if public.fn_my_role() <> 'owner' then raise exception 'not authorized'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'void reason required'; end if;
  select * into v_old from public.transactions where id = p_tx for update;
  if not found then raise exception 'transaction not found'; end if;
  if v_old.voided_at is not null then return; end if; -- idempotent
  update public.transactions set voided_at = now(), correction_reason = trim(p_reason), updated_at = now() where id = p_tx;
  perform public.fn_audit_reason('VOID', 'transactions', p_tx::text,
    jsonb_build_object('amount', v_old.amount), jsonb_build_object('voided', true), trim(p_reason));
end $$;
