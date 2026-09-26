# DentalVibe — EHR File Upload / Storage / Viewing Security: Report

Repo `AttilaHuns288452/dentalvibe` · main @ `146b90d` · DB `wfmtkmfevdqbhtpqamic`

## A. What was already secure/correct (left unchanged)
- Bucket `ehr-files` exists and is **private** (`public=false`).
- Single storage policy `ehr files staff all`: `authenticated` where `fn_my_role() IN ('doctor','owner')`
  — covers ALL verbs (list/read/write/delete/sign). Patients and deactivated staff
  (`fn_my_role()` returns null) are denied every verb at the Storage layer, independently of the UI.
- `ehr_attachments` metadata policy (`ehr staff all`) mirrors the same staff-role boundary.
- Authorization model is **staff-role based** (single clinic: any active doctor/owner may access any
  clinic patient's EHR — identical to what the database layer already permits); "unauthorized"
  = non-staff roles and deactivated staff, both denied.
- Files viewed through short-lived signed URLs (`createSignedUrl(path, 60)`) — preserved.
- Upload sequence with rollback: Storage upload → `ehr_attachments` insert → Storage object removed
  if the insert fails (`upsert: false` throughout).
- Filename safety: patient folder is the server-derived patient UUID; filenames are sanitized
  (`[^\w.\-]` → `_`) + timestamped; traversal characters cannot survive; collisions need same
  millisecond + same name AND still fail on `upsert:false`.
- Delete order (file → metadata) is retry-safe: an interrupted delete completes on retry
  (missing file removes as a no-op).
- EHR audit coverage (upload/update/delete via `trg_audit_ehr_attachments`) with actor/before/after;
  audit rows carry metadata only — **no file contents** (metadata JSON: ids, category, filename, path).
- History/category behavior (historical categories stay visible, LATEST marking, version-preserving
  uploads) — regression-tested green.

## B. What was missing or inconsistent
1. **Live-only configuration (§2):** the bucket, its storage policy, and the `ehr_attachments` policy
   existed ONLY in the live project — a clean environment could not reproduce the security posture.
2. **No server-side validation boundary (§5):** the bucket had `file_size_limit = none` and
   `allowed_mime_types = any` — client checks were the only size/type gate.
3. **`accept` attribute mismatch (§5):** JavaScript accepted WEBP but `<input accept>` did not
   advertise it (and no declared-MIME check existed — extension only).
4. **CDN caching of object GETs (§8/§11):** default `max-age=3600` meant a raw object fetch could
   serve deleted/revoked bytes from cache (proven during QA — the delete DID happen but a cached
   download still returned 200).
5. **Silent viewer failure (§11):** a failed/expired signed URL opened nothing with no message.

## C. Exact Storage/RLS changes (migration `0039_ehr_storage.sql`)
- `storage.buckets('ehr-files')`: forced `public=false`, **`file_size_limit=10485760` (10 MB)**,
  **`allowed_mime_types = {image/jpeg, image/png, image/webp, application/pdf}`** (server-enforced).
- Storage policy `ehr files staff all` recreated **identically** (drop-if-exists + same predicate) —
  no duplication, no behavior change.
- `ehr_attachments` policy `ehr staff all` recreated identically.
- RLS was NOT weakened anywhere; the bucket was NOT made public.

## D. Exact file-validation changes (client)
- `<input accept>` now advertises `.png,.jpg,.jpeg,.webp,.pdf` + the four MIME types.
- Declared MIME is checked against the same allowlist as the extension (extension alone is not
  treated as a file-type check).
- Hint copy updated ("PNG · JPG · WEBP · PDF · max 10 MB").
- Uploads set `cacheControl: 'no-store'` so deletes/permission changes take effect immediately.
- Viewer: signed-URL failure now shows "Couldn't open this file … Tap View again to retry."
  (retry re-signs the same record — never creates a duplicate).

## E. New QA (`frontend/ehr_storage_qa.mjs`, 22 cases — all against the raw Storage/DB APIs)
patient: list/download/signed-url/upload/delete all denied + metadata unreadable ·
doctor: authorized upload + metadata + audit · signed URL works (bytes roundtrip), is
`/sign/`-style (never `/object/public/`) · owner can sign · **expired signed URL serves nothing** ·
deactivated staff denied list/read/sign/upload · wrong MIME rejected **by the bucket** · >10 MB
rejected **by the bucket** · traversal path cannot escape (404 route) · `upsert:false` refuses
overwrite · delete consistency (file + metadata gone, verified via remove-response + list — NOT via
download-after, which is CDN-cacheable) · already-missing object deletes as a safe no-op · upload +
delete both audited.

## F. QA results
```
Build:                  PASS
ehr_storage_qa (NEW):   22/22
ehr_qa (regression):    16/16   (categories, history, LATEST, patient denial intact)
ehr_link_qa:             7/7
cross_role_qa:          22/22
```

## G. Live configuration reconciled into migrations
`0039_ehr_storage.sql` — bucket + `ehr files staff all` storage policy + `ehr staff all` metadata
policy (all previously live-only). A clean environment now reproduces the exact same posture plus
the new enforced limits.

## H. Remaining limitations
- **Content sniffing:** Supabase Storage enforces size + declared content-type at the API boundary;
  it does not sniff magic bytes. A malicious staff member could upload non-image bytes under a
  declared `image/png` type. Deep content inspection would require an edge-function/AV pipeline —
  deliberately NOT built (no demonstrated requirement; §5 scope). Client-side, the declared MIME +
  extension are both checked.
- **Pre-existing objects** created before `cacheControl: 'no-store'` retain `max-age=3600` metadata;
  their exposure is bounded by the 60-second signed-URL TTL. New uploads are `no-store`.
- Signed-URL TTL stays **60 seconds** by design (not increased); the 1-second-TTL expiry case is
  covered by QA.
- Access granularity is **staff-role level** (any active doctor/owner may open any clinic patient's
  EHR) — consistent with the product's database authorization model; per-patient doctor assignment
  restrictions are not part of this product's model.
- Upload→metadata cannot be one atomic transaction across Storage + PostgreSQL (two systems): the
  rollback-on-failure + retry-safe delete order bound the window, and both failure directions leave
  only harmless orphans (an unreferenced storage object, or a metadata row whose file is missing —
  both are cleaned by a retry of the same action).
