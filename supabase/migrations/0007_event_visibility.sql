-- 0007_event_visibility.sql — owner can inspect the provider event ledger.
-- (rls_auto_enable turned RLS on with zero policies: nobody could read it.)
drop policy if exists "events owner read" on public.provider_events;
create policy "events owner read" on public.provider_events for select
  to authenticated using (fn_my_role() = 'owner');
