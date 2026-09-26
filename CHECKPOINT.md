# CHECKPOINT — DentalVibe final hardening (multi-dentist capacity session)

**State: PAUSED mid-task. Resume from here.** Written 2026-09-26.

## What is DONE and verified (committed `96d9665` + earlier `e10d5ea`)

### Database (applied to project `wfmtkmfevdqbhtpqamic` AND captured in `supabase/migrations/`)
- `0021_dentist_capacity.sql` — `dentist_ready(dentist_id, clinic_date, ready, ready_at, updated_at, UNIQUE(dentist_id,clinic_date))`.
  **Capacity model (locked decision):** an ACTIVE dentist counts available for a date UNLESS a `ready=false` row exists that date ("Not Ready"); `ready=true` makes today explicit; rows expire with the day. Deactivated dentists never count and cannot become Ready (guard trigger). N available dentists = N parallel slots (nothing hardcoded).
  `fn_appt_dentist_guard` (BEFORE INSERT/UPDATE, replaces the global overlap guard): per-dentist overlap among `payment_status in (pending,paid)` + `status<>cancelled`; auto-assigns the LEAST-LOADED available dentist (tie-break dentist id) under `pg_advisory_xact_lock('dv-assign:<date>')`; explicit `dentist_id` validated; no candidate → `'no dentist available for that time'`.
  Helpers: `fn_dentist_available(dentist,date)`, `fn_dentist_free(dentist,start,mins,exclude)`. RLS on `dentist_ready`: read all authed, dentist writes own row, owner all.
- `0022_audit_log.sql` — `audit_log` += `actor_role, before_data, after_data, reason`; `fn_audit` v2 captures before/after + role; `fn_audit_reason(...)` helper; RLS owner-read + append-only.
- `0023`+`0026_processed_semantics.sql` — `provider_events.processed_at` **nullable, NO default** (root cause found: it was `NOT NULL DEFAULT now()` = auto-stamped every insert = retry loss). Old stamps cleared. Also `fn_notify_patient` copy: "Your visit is complete — thank you for visiting." (receipt wording gone).
- `0024_finance_corrections.sql` — `transactions` += `voided_at, correction_reason, updated_at`; `fn_correct_transaction(tx, amount, reason)` (owner-only, reason ≥3 chars, amount >0, voided-guard) + `fn_void_transaction(tx, reason)` (idempotent); owner-only UPDATE/DELETE RLS.
- `0025_per_dentist_conflict.sql` — `fn_apply_payment_result` + `fn_set_payment_projection` conflict checks scoped to the assigned dentist (parallel capacity).

### Edge Functions (deployed, ACTIVE)
- `paymongo-webhook` **v6** (source = `supabase/functions/paymongo-webhook/index.ts`, kept in sync): received ≠ processed; transient failure (provider unsettled/read error) → 500 + stays UNPROCESSED; same event retry re-processes; success (or already-paid) stamps `processed_at`; duplicates after processing = acked no-ops.

### Tests green (last runs)
- `pay_webhook_qa.mjs` **27/27** incl. the MANDATORY retry regression (W12: 500-unprocessed → same event `reprocessed:true` → paid + 1 tx + 1 notification + processed → duplicate ack).
- `pay_lifecycle_qa.mjs` **7/7** (updated to per-dentist semantics: 1b = explicit same-dentist insert rejected; 3a/3c = same-dentist resurrection blocked; 3 forces rebooking onto apptA's dentist).
- `pay_smoke.mjs` 13/13.

## What LANDED + WORKER-REPORTED GREEN (self-reports, orchestrator spot-verify on resume) — commit `2a3e4cc`
- **Capacity UI:** `scheduling.js`, `availability.js` (slotStartsForDentists), `Book.jsx`, `DoctorCalendar.jsx` (own-appointments + Ready toggle), `capacity_qa.mjs` **33/33** (cases a–j + UI smoke; incl. concurrency case f: two simultaneous inserts, exactly one wins).
- **Finance + Audit UI:** `finance.js`, `IncomeHub.jsx` (Correct/Void modals, reason required, voided struck+excluded from totals), `OwnerAudit.jsx` + `/owner/audit` route + Manage entry link, `finance_qa.mjs` **26/26**, `audit_qa.mjs` **18/18**. Also fixed `exportReport` missing `clinicName` import.
- **Notifications + copy:** `Notifications.jsx` (row click → read + navigate route), `MyAppointments.jsx`/`ResetPassword.jsx` ("Clinic hours unavailable" fallbacks; zero receipt-upload leftovers found), `push_qa.mjs` **33/33** (endpoint-scoped cleanup + new deep-link checks 28/28b/29/29b), `notification_qa.mjs` **12/12** (NEW).

## DB captures applied after the workers (migration `0027_rls_fixes.sql`)
- (1) `dentist_ready` ready-own-write/update policies now use `lower(auth.jwt() ->> 'email')` (worker found the 0021 `auth.users` reference broke every doctor self-write; fixed live + captured).
- (2) `audit_log` insert policy tightened to `with check (false)` (was `true` — bare return=minimal POSTs could forge rows; trigger writes are SECURITY DEFINER and unaffected). RE-RUN `audit_qa.mjs` on resume to confirm the tighten doesn't break its asserts.

## RESUME STEPS (in order)
1. Spot-verify the three workstreams (workers' reports claim green — confirm, don't re-derive): `cd frontend && npm run build`, then run `capacity_qa.mjs`, `finance_qa.mjs`, `audit_qa.mjs` (especially after 0027), `notification_qa.mjs`, `push_qa.mjs` (QA_CHROME=/home/attila/tools/google-chrome/opt/google/chrome/chrome, headed).
2. Full regression matrix (qa, qa:e2e, qa:security, qa:cross-role, qa:ehr, qa:scheduling, qa:payment incl. pay_webhook_qa) — journey_qa P12 and appointment flows may need re-pinning to per-dentist behavior.
3. §6 legacy-copy repo sweep: grep 'receipt', '8 AM', '10 AM – 5 PM', 'Attach receipt' repo-wide once more.
4. Data hygiene: scan `dentists` for `QA %` rows and test transactions (worker incidents: one deactivation test used the owner's dentist row then restored it — verify owner dentist is active).
5. Commit, push (Vercel auto-deploys), run push_qa + cross_role against https://dentalvibe.vercel.app, then write the §10 final report (12 sections).
6. Physical Android/iPhone = NOT VERIFIED (no devices) — keep that distinction explicit.

## Key facts for the resumed session
- Preview server: `cd frontend && npx vite preview --port 4176` (may need restart).
- Env: `SB_SECRET` + `SB_ANON=$(grep VITE_SUPABASE_ANON_KEY .env.local | cut -d= -f2)`; push QA needs `QA_CHROME` + headed + persistent profiles (unbranded Chromium cannot register push).
- provider_mode = **test**. Live ₱1 smoke still awaiting the user's scan.
- Assignment strategy = LEAST-LOADED ready dentist, tie-break id (documented in 0021).
- `audit_log` is append-only (no update/delete policies). Corrections go through `fn_correct_transaction`/`fn_void_transaction`.
