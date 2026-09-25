-- 0009_clinic_hours.sql -- clinic hours 10:00–17:00
update public.clinic_settings set open_time = '10:00' where open_time <> '10:00';
