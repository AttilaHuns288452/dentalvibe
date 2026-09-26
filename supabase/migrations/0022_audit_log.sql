-- 0022_audit_log.sql — human-readable audit: WHO / WHAT / WHEN / before → after.
-- Extends the existing audit_log (append-oriented; no update/delete policies).
alter table public.audit_log add column if not exists actor_role text;
alter table public.audit_log add column if not exists before_data jsonb;
alter table public.audit_log add column if not exists after_data jsonb;
alter table public.audit_log add column if not exists reason text;

-- generic table-change audit captures before/after (truncated) + actor role
create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  insert into public.audit_log(actor_id, actor_role, action, entity, entity_id, before_data, after_data)
  values (auth.uid(), v_role, tg_op, tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- finance corrections/voids carry an explicit reason in the audit trail
create or replace function public.fn_audit_reason(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_reason text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.audit_log(actor_id, actor_role, action, entity, entity_id, before_data, after_data, reason)
  select auth.uid(), pr.role, p_action, p_entity, p_entity_id, p_before, p_after, p_reason
    from (select role from public.profiles where id = auth.uid()) pr;
$$;

-- audit rows are append-only: RLS enabled, owner read, no update/delete policies
alter table public.audit_log enable row level security;
drop policy if exists "audit owner read" on public.audit_log;
create policy "audit owner read" on public.audit_log for select using (public.fn_my_role() = 'owner');
drop policy if exists "audit insert definer" on public.audit_log;
create policy "audit insert definer" on public.audit_log for insert with check (true);
