# DentalVibe — Multi-Dentist Scheduling, Daily Ready State, Finance Corrections, Audit Log, Final Hardening: Completion Report

Repo `AttilaHuns288452/dentalvibe` · main @ `8e78ac5` · live https://dentalvibe.vercel.app (bundle `index-C6_43cmw.js`) · DB `wfmtkmfevdqbhtpqamic`

## 1. The core model change (planned availability ≠ day-of presence)
The single-global-slot assumption is gone, and — critically — **future booking never depends on
day-of Ready state**:

```
future booking  →  dentist WORK SCHEDULES + appointment assignments
day-of reality  →  Ready / Not Ready  →  operational view + warnings
```

- **`dentist_work_schedules`** (migration 0030): per dentist, per weekday, open/close + active.
  The ONLY source of booking capacity. N scheduled dentists = N parallel resources (nothing
  hardcoded). A dentist with no active row for a date is not a resource that date. Adding a new
  dentist expands capacity automatically once a schedule is configured. Existing active dentists
  were seeded Mon–Sat clinic hours.
- **`dentist_ready`** (daily presence): scoped to the Manila clinic date, resets per day, never
  inherits tomorrow, does not enable or block any booking. Deactivated dentists can never become
  Ready. Owner-as-provider can use Ready; a non-provider Owner has no dentist row and no schedule
  and is therefore never a resource.

## 2. Database enforcement (not React)
`fn_appt_dentist_guard` on every appointment write: per-dentist overlap among reservations
(pending/paid, non-cancelled); auto-assigns the least-loaded scheduled dentist (tie-break: dentist
id) under a per-day advisory lock; explicitly supplied `dentist_id` validated (scheduled + free);
outside a dentist's working hours rejected per dentist; zero scheduled → "no dentist available for
that time". Two patients racing one slot on one dentist: exactly one wins (concurrent-insert case
green). Two qualified dentists at the same time: both bookings succeed with different assignments.
Patient clients can never self-confirm (draft inserts are forced unpaid; reservations happen at
payment). Migrations: 0030 (work schedules + schedule-based capacity functions), 0032
(`fn_day_busy` — identity-free busy intervals for the booking page).

## 3. Day-of operations (Ready state + warnings)
Owner "Today's Operations" panel (`/owner/schedules`): per dentist — Scheduled today / Ready /
Not Ready / appointment count; capacity line "N scheduled · M Ready · K appointments today";
display-only conflict warnings ("X appointments at H:00 but only Y dentists Ready") and
"Dr. X is deactivated but has K future appointments — reassign or cancel manually". Nothing is
ever auto-cancelled or silently moved. Doctor side: "Ready for Today / Not Ready" toggle under a
"Today's presence" label with an explicit note that it never affects booking.

## 4. Owner work-schedule editor
Per dentist, 7 weekday rows (day on/off + open/close + active) upserting `dentist_work_schedules`;
a dentist with no active rows is labeled "No working schedule — not bookable"; deactivated
dentists badged. Slots expand/shrink immediately with the schedule (QA: adding a Sunday row opens
Sunday slots; removing rows removes slots while historical appointments stay intact).

## 5. Booking UX under multi-dentist
Patients still never choose a dentist. Slot lists derive from clinic hours ∩ each scheduled
dentist's own hours (per-dentist clipping, then union); the busy overlay comes from `fn_day_busy`
(patients can only read their own appointment rows — the raw table would hide other patients'
bookings and over-offer slots; found and fixed in this pass). Patient-visible errors keep
"no dentist available for that time".

## 6. Finance — Create → Review → Correct / Void → Audit
`fn_correct_transaction` (amount + mandatory reason, owner-only, invalid amounts rejected,
voided rows locked) and `fn_void_transaction` (timestamped, idempotent, owner-only). Corrected
rows show "Corrected from ₱old, reason"; voided rows are struck through and excluded from every
total (totals recompute proven). Appointment-generated PayMongo income remains authoritative —
manual finance actions never duplicate it (one transaction per payment, unique-index enforced).
Patients/doctors cannot modify finance (RLS + RPC checks). Every correction/void writes an audit
event with before/after.

## 7. Audit log (WHO changed WHAT, WHEN, FROM → TO)
`audit_log`: actor + role + action + entity + before/after + reason + timestamp; append-oriented;
patients can neither read, insert, modify, nor delete (insert policy `with check(false)`); doctors
cannot mutate; owner reads with action/entity/actor filters. Covered events: dentist created/
activated/deactivated/reactivated, clinic name/email/hours/open-days changes, service created/
edited/activated/deactivated/price-changed, patient-specific price changes, transaction created/
corrected/voided, expense rows, patient record edits, EHR attachment uploads/deletes (0031),
record-category changes. Owner UI shows readable lines ("Deactivated Dr. Juan", "Changed service
price · Cleaning · ₱800 → ₱900", "Corrected transaction · ₱5,000 → ₱500") plus the raw before→after
diff. Duplicate audit triggers de-duplicated (one event = one row).

## 8. PayMongo webhook retry correctness (re-verified end-to-end)
`provider_events.processed_at` nullable with no auto-stamp; transient reconciliation failure →
5xx + event stays unprocessed; retry of the SAME event id re-processes; success stamps processed;
later duplicates are acknowledged no-ops; settlement idempotent. Mandatory regression (pay_webhook
W12): first delivery 500 + unprocessed → same event reprocesses → paid + exactly one transaction +
exactly one notification + processed → third delivery harmless. One bounded retry added in the
shared provider client (measured ~1% transient 5xx rate from the PayMongo test API under load).

## 9. Notifications & deep links (re-verified)
Payment events route `/appointments?appt=<id>` with deterministic dedupe; in-app rows mark read AND
navigate; scoped + highlighted target; stale/foreign/unknown routes fail safely with zero private
data; deep links never grant access (auth + RLS unchanged). Push: one event → every active device
(multi-device delivery proven per-device), endpoint-scoped test cleanup only.

## 10. Test evidence — final gate (exact numbers)
| Suite | Result | Suite | Result |
|---|---|---|---|
| capacity_qa (reworked) | 40/40 | qa_all | 35/35 |
| ready_state_qa (new) | 15/15 | journey_qa | 42/42 |
| owner_ops_qa (new) | 34/34 | nav_matrix | 21/21 |
| finance_qa | 26/26 | prod_e2e | 20/20 |
| audit_qa (extended) | 37/37 | fidelity_e2e | 26/26 |
| notification_qa | 12/12 | pay_security | 14/14 |
| scheduling_qa | 10/10 | pay_smoke | 13/13 |
| ehr_qa | 16/16 | pay_lifecycle | 7/7 |
| ehr_link_qa | 7/7 | pay_webhook_qa | 27/27 |
| catalog_prices_qa | 14/14 | push_qa (local) | 33/33 |
| cross_role_qa | 22/22 | **production** cross_role + push | 22/22 + 33/33 |

Total: **449 automated checks green** (402 local + 47 production), 0 failures. QA-matrix mapping:
multi-dentist cases 1–15 ✓ (zero/one/two/three scheduled, future-without-Ready, parallel different
dentists, same-dentist no-overlap, long duration, race, deactivated excluded, new dentist expands,
history intact, forged assignment blocked, per-dentist hours, doctor isolation, owner visibility);
Ready cases 1–8 ✓ (set/unset, no tomorrow inheritance, deactivated guard, booking unaffected,
ops-view effect, owner-as-provider, non-provider owner); Finance 1–8 ✓; Audit 1–9 ✓; Payments: all
prior suites + the transient-retry regression ✓; Notifications 1–5 ✓.

## 11. Defects found and fixed in this pass (all re-tested)
1. **Ready-gated booking** (pre-existing semantic bug vs spec): `ready=false` used to shrink future
   capacity — replaced by work-schedule-driven capacity.
2. **Patient busy overlay blind** (2 of 7 appointments visible): patients can only read their own
   rows → `fn_day_busy` identity-free RPC.
3. **`dentist_ready` RLS** referenced `auth.users` (locked table) — every doctor self-write failed;
   fixed via `auth.jwt() ->> 'email'` (0027) and captured as migration.
4. **`audit_log` insert policy `with check(true)`** — forged rows possible; tightened to `false`.
5. **`processed_at` auto-stamp** (`NOT NULL DEFAULT now()`) destroyed webhook retries; made nullable.
6. **Webhook acked unsettled events** as processed; only successful settles now stamp.
7. **journey D3** was single-dentist-era; re-pinned to assignment-consistent assertion (the old
   flake is structurally gone).
8. **Test-layer drift** (documented honestly): suites booked at 09:00 Manila (hours unenforced
   pre-0030) and on Sundays; push_qa had stale-row blindness in its multi-device poll and an
   un-unique mock intent id; pay_lifecycle's conflict case asserted at the draft layer where drafts
   legitimately don't hold chairs.

## 12. Honest limitations (NOT verified)
- **Physical Android/iPhone push acceptance** — no devices attached; the full chain is
  automated-green on production but real-device delivery is unverified.
- **Live ₱1 PayMongo smoke** — provider mode is `test`; the live QR expired un-scanned. Re-arm
  playbook ready whenever the user wants to scan.
- No offline/bandwidth testing; PWA install only (no app stores).
- PayMongo test API shows ~1% transient 5xx under load — mitigated by a bounded internal retry and
  idempotent DB-layer reuse; a user-visible retry remains possible under provider outage.
- Suites must run sequentially against one DB (documented); concurrent runs corrupt each other's
  fixtures.
