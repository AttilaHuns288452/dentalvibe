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

## What LANDED but is NOT YET VERIFIED (working tree, uncommitted)
Three parallel workstreams wrote these files (their completion reports arrived after pause — treat claims as unverified):
- **Capacity UI:** `frontend/src/lib/scheduling.js`, `availability.js`, `Book.jsx`, `DoctorCalendar.jsx`, `capacity_qa.mjs`
- **Finance + Audit UI:** `frontend/src/lib/finance.js`, `IncomeHub.jsx`, `OwnerAudit.jsx`, `App.jsx` (route), `finance_qa.mjs`, `audit_qa.mjs`
- **Notifications + copy:** `Notifications.jsx`, `MyAppointments.jsx`, `ResetPassword.jsx`, `push_qa.mjs`, `notification_qa.mjs`; `OwnerManage.jsx` (likely the Audit entry link)

## RESUME STEPS (in order)
1. `cd ~/Documents/Projects/dentalvibe/frontend && npm run build` — fix any breakage in the unverified files first.
2. Re-read each workstream diff (`git diff` + new files) against its brief before trusting it:
   - capacity: Ready toggle on DoctorCalendar (own-appointments filter, deactivated-disabled), capacity-aware Book slots, no client-sent dentist_id on booking.
   - finance: Correct/Void modals with required reason, voided excluded from totals, OwnerAudit screen + filters + owner-only.
   - notifications: row click → mark read + navigate(route); fallbacks say "Clinic hours unavailable"; push_qa cleanup is endpoint-scoped (NOT delete-by-user).
3. Run: `capacity_qa.mjs`, `finance_qa.mjs`, `audit_qa.mjs`, `notification_qa.mjs`, `push_qa.mjs` (QA_CHROME=/home/attila/tools/google-chrome/opt/google/chrome/chrome), then the full matrix (qa, qa:e2e, qa:security, qa:cross-role, qa:ehr, qa:scheduling, qa:payment incl. pay_webhook_qa) — journey_qa P12 and appointment flows may need re-pinning to per-dentist behavior.
4. ALSO RUN the leftover task-1 QA cases not yet covered anywhere: concurrency case (two simultaneous bookings, one dentist → exactly one wins) is in capacity_qa (f) — verify it actually asserts that.
5. §6 legacy-copy repo sweep: grep 'receipt', '8 AM', '10 AM – 5 PM', 'Attach receipt' repo-wide once more.
6. Data hygiene: QA suites create dentists/transactions — scan `dentists` for `QA %` rows and test transactions before finishing.
7. Commit, push (Vercel auto-deploys), run push_qa + cross_role against https://dentalvibe.vercel.app, then write the §10 final report (12 sections).
8. Physical Android/iPhone = NOT VERIFIED (no devices) — keep that distinction explicit.

## Key facts for the resumed session
- Preview server: `cd frontend && npx vite preview --port 4176` (may need restart).
- Env: `SB_SECRET` + `SB_ANON=$(grep VITE_SUPABASE_ANON_KEY .env.local | cut -d= -f2)`; push QA needs `QA_CHROME` + headed + persistent profiles (unbranded Chromium cannot register push).
- provider_mode = **test**. Live ₱1 smoke still awaiting the user's scan.
- Assignment strategy = LEAST-LOADED ready dentist, tie-break id (documented in 0021).
- `audit_log` is append-only (no update/delete policies). Corrections go through `fn_correct_transaction`/`fn_void_transaction`.
