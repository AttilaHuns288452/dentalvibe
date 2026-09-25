-- 0010_record_categories.sql — configurable EHR record categories.
-- Owner manages categories (add / rename / activate / reorder / archive).
-- Doctor+owner use active categories for uploads. Patients: no access.
-- History rule: ehr_attachments keeps its category TEXT snapshot forever;
-- category_id links to the managed row. Deactivated/archived categories stay
-- viewable on historical records. Categories referenced by records are never
-- hard-deleted (FK blocks it) — archive is the "remove".

create table if not exists public.record_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- default categories (the clinic's starting set)
insert into public.record_categories (name, sort_order) values
  ('Handwritten Patient Record', 1),
  ('X-Ray', 2),
  ('Lab Result', 3),
  ('Consent Form', 4),
  ('Prescription', 5),
  ('Referral', 6),
  ('Other', 7)
on conflict (name) do nothing;

alter table public.record_categories enable row level security;

drop policy if exists "record cats owner all" on public.record_categories;
create policy "record cats owner all" on public.record_categories
  for all to authenticated
  using (fn_my_role() = 'owner')
  with check (fn_my_role() = 'owner');

drop policy if exists "record cats staff read" on public.record_categories;
create policy "record cats staff read" on public.record_categories
  for select to authenticated
  using (fn_my_role() = any(array['doctor'::text, 'owner'::text]));

alter table public.ehr_attachments add column if not exists category_id uuid references public.record_categories(id);

-- link existing uploads to categories where the name matches
update public.ehr_attachments a
set category_id = r.id
from public.record_categories r
where a.category_id is null
  and (lower(r.name) = lower(a.category) or lower(r.name) like lower(a.category) || ' %');
