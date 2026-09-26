-- 0031_ehr_audit.sql — audit coverage gaps: EHR attachment uploads/deletes and
-- record-category changes. Also de-duplicates the double audit triggers (dentists
-- and clinic_settings each fired fn_audit twice per change).
drop trigger if exists audit_dentists on public.dentists;
drop trigger if exists audit_settings on public.clinic_settings;

drop trigger if exists trg_audit_ehr_attachments on public.ehr_attachments;
create trigger trg_audit_ehr_attachments after insert or update or delete on public.ehr_attachments
for each row execute function public.fn_audit('ehr_attachment');

drop trigger if exists trg_audit_record_categories on public.record_categories;
create trigger trg_audit_record_categories after insert or update or delete on public.record_categories
for each row execute function public.fn_audit('record_category');
