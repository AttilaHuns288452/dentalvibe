-- 0029_available_dentist_ids.sql — patients need available-dentist IDS for
-- capacity-aware slots but must NOT read dentists rows (RLS is doctor/owner/
-- self by design). This function exposes exactly the id set and nothing else.
create or replace function public.fn_available_dentist_ids(p_date date)
returns setof uuid
language sql
security definer
set search_path to 'public'
stable
as $$
  select d.id from public.dentists d
   where d.active = true
     and not exists (select 1 from public.dentist_ready r
                      where r.dentist_id = d.id and r.clinic_date = p_date and r.ready = false)
   order by d.id
$$;
revoke all on function public.fn_available_dentist_ids(date) from public;
grant execute on function public.fn_available_dentist_ids(date) to authenticated;
