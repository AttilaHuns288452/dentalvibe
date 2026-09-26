-- 0027_rls_fixes.sql — capture of live fixes + one security tightening.
--
-- (1) dentist_ready RLS: the 0021 policies used `auth.users` directly, but
-- auth.users is RLS-locked with zero policies — every doctor self-write failed
-- with 'permission denied for table users'. Fixed live during capacity QA;
-- this migration reproduces the fix (identity via the JWT claim instead).
drop policy if exists "ready own write" on public.dentist_ready;
create policy "ready own write" on public.dentist_ready for insert
  with check (exists (select 1 from public.dentists d
                       where d.id = dentist_id
                         and lower(d.email) = lower(auth.jwt() ->> 'email')));
drop policy if exists "ready own update" on public.dentist_ready;
create policy "ready own update" on public.dentist_ready for update
  using (exists (select 1 from public.dentists d
                  where d.id = dentist_id
                    and lower(d.email) = lower(auth.jwt() ->> 'email')));

-- (2) audit_log insert policy was `with check (true)` — any authenticated role
-- could append forged audit rows via a bare return=minimal POST. Audit writes
-- come from SECURITY DEFINER trigger functions (which bypass RLS); human app
-- writes are only the owner's explicit transaction corrections (via fn_audit).
-- Deny direct inserts entirely at the policy layer.
drop policy if exists "audit insert" on public.audit_log;
create policy "audit insert" on public.audit_log for insert
  with check (false);
