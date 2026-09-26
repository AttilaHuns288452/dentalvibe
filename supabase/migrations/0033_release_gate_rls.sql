-- 0033_release_gate_rls.sql — release-gate security fixes.
--
-- (1) AUDIT LOG: two INSERT policies existed — "audit insert" (with check false)
-- and "audit insert definer" (with check TRUE, role public). Permissive policies
-- OR together, so the permissive one let ANY client forge audit rows. Drop every
-- INSERT policy by discovery: with zero INSERT policies, clients cannot insert at
-- all (default deny), while SECURITY DEFINER audit functions/triggers still write
-- (they run as the table owner, which bypasses RLS). Owner read stays
-- ("audit owner read"); UPDATE/DELETE have no policies = denied for all clients.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'audit_log' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.audit_log', p.policyname);
  end loop;
end $$;

-- (2) TRANSACTIONS: remove both client DELETE paths ("transactions owner delete"
-- and the ALL policy's DELETE half). The financial model is Create -> Review ->
-- Correct / Void -> Audit; hard deletes are maintenance-only (SQL/service role).
-- Owner keeps INSERT (manual income/expense) and UPDATE (correct/void RPCs).
drop policy if exists "transactions owner delete" on public.transactions;
drop policy if exists "transactions owner all" on public.transactions;
drop policy if exists "transactions owner insert" on public.transactions;
drop policy if exists "transactions owner read" on public.transactions;
-- NOTE (found the hard way): "owner all" bundled SELECT — dropping it silently
-- broke INSERT..RETURNING (rows filtered by the missing select policy). Restore
-- read explicitly; INSERT (walk-in entries) and UPDATE (correct/void) stay
-- owner-only; DELETE has no policy = denied for every client role.
create policy "transactions owner read" on public.transactions as permissive for select
  to authenticated
  using (fn_my_role() = 'owner');
create policy "transactions owner insert" on public.transactions as permissive for insert
  to authenticated
  with check (fn_my_role() = 'owner');
