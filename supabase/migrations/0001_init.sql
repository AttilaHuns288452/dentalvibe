-- dentalvibe initial schema (mirrors the dental app's tables, clean project)

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0,
  duration_minutes int not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  birthdate date,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.dentists (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  role text not null default 'doctor' check (role in ('doctor','owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  dentist_id uuid references public.dentists(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  scheduled_at timestamptz,
  status text not null default 'pending' check (status in ('pending','approved','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

-- RLS on everything
alter table public.services     enable row level security;
alter table public.patients     enable row level security;
alter table public.dentists     enable row level security;
alter table public.appointments enable row level security;

-- Public read for the clinic catalog (booking screen needs it pre-auth)
create policy "services readable by anyone" on public.services for select using (true);

-- Authenticated app users get full CRUD for now (tighten per-role later)
create policy "patients full access for authenticated" on public.patients for all to authenticated using (true) with check (true);
create policy "dentists full access for authenticated" on public.dentists for all to authenticated using (true) with check (true);
create policy "appointments full access for authenticated" on public.appointments for all to authenticated using (true) with check (true);

-- Seed the service catalog
insert into public.services (name, price, duration_minutes) values
  ('Braces Consultation', 500.00, 30),
  ('Oral Prophylaxis', 800.00, 45),
  ('Tooth Filling', 1200.00, 60),
  ('Tooth Extraction', 1500.00, 45);
