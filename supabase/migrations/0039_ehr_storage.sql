-- 0039_ehr_storage.sql — EHR storage security, made reproducible (§2) and
-- given a server-side validation boundary (§5).
--
-- The bucket + its storage policy + ehr_attachments RLS existed LIVE ONLY (no
-- migration ever created them). Capture them here so a clean environment
-- reproduces the exact same security posture. Policies are drop+recreate with
-- their CURRENT live shapes — no duplication, no behavior change — except the
-- bucket gains enforced limits (size + MIME allowlist), which were previously
-- absent.

-- bucket: PRIVATE, 10 MB cap, the four intended types (server-enforced —
-- Storage rejects oversize/wrong-content-type uploads regardless of client)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ehr-files', 'ehr-files', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects policy (identical to live): active staff (doctor/owner) only.
-- Patients and deactivated staff (fn_my_role() = null) are denied every verb —
-- list/read/write/delete/sign are all covered by this single ALL policy.
drop policy if exists "ehr files staff all" on storage.objects;
create policy "ehr files staff all" on storage.objects for all
  to authenticated
  using (bucket_id = 'ehr-files' and fn_my_role() = any (array['doctor', 'owner']))
  with check (bucket_id = 'ehr-files' and fn_my_role() = any (array['doctor', 'owner']));

-- metadata table policy (identical to live): same staff-role boundary
drop policy if exists "ehr staff all" on public.ehr_attachments;
create policy "ehr staff all" on public.ehr_attachments for all
  to authenticated
  using (fn_my_role() = any (array['doctor', 'owner']))
  with check (fn_my_role() = any (array['doctor', 'owner']));
