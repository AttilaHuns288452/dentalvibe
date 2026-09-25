-- 0013_patient_claim.sql — one human, one patient record.
-- A clinic-created walk-in record (email set, no account) is CLAIMED at
-- self-registration: the signup links the account to the existing record
-- (history, code, and clinic-entered data survive) instead of creating a
-- duplicate. The partial unique index makes duplicates impossible at the
-- schema level. NULL emails (walk-ins without email) stay unlimited.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_existing uuid;
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', '');
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, v_name, 'patient');

  select id into v_existing from public.patients
   where lower(email) = lower(new.email) and user_id is null
   order by created_at limit 1;

  if v_existing is not null then
    -- claim the walk-in record: link the account, fill only blank fields
    update public.patients
       set user_id = new.id,
           full_name = coalesce(nullif(full_name, ''), v_name),
           phone = coalesce(phone, nullif(new.raw_user_meta_data->>'phone', '')),
           birthdate = coalesce(birthdate, nullif(new.raw_user_meta_data->>'birthdate', '')::date),
           sex = coalesce(sex, nullif(new.raw_user_meta_data->>'sex', '')),
           address = coalesce(address, nullif(new.raw_user_meta_data->>'address', '')),
           emergency_contact = coalesce(emergency_contact, nullif(new.raw_user_meta_data->>'emergency_contact', ''))
     where id = v_existing;
  else
    insert into public.patients (user_id, full_name, email, phone, birthdate, sex, address, emergency_contact, medical_note, patient_code)
    values (new.id,
      v_name,
      new.email,
      new.raw_user_meta_data->>'phone',
      nullif(new.raw_user_meta_data->>'birthdate', '')::date,
      new.raw_user_meta_data->>'sex',
      new.raw_user_meta_data->>'address',
      new.raw_user_meta_data->>'emergency_contact',
      new.raw_user_meta_data->>'medical_note',
      'DAR-' || lpad(((select count(*) + 1 from public.patients)::text), 4, '0'));
  end if;
  return new;
end $$;

-- backstop: one record per email, enforced where the invariant lives
create unique index if not exists ux_patients_email on public.patients (lower(email)) where email is not null;
