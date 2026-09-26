# DentalVibe — Final Production Hardening + Multi-Dentist Capacity: Completion Report

Repo `AttilaHuns288452/dentalvibe` · main @ `3cd0c53` · live https://dentalvibe.vercel.app · DB `wfmtkmfevdqbhtpqamic`
Final gate: **365 automated checks, 0 failures** (local) + **55 against production** (cross-role 22, push 33).

## 1. Multi-dentist / parallel capacity (the core change)
The one-global-slot assumption is gone. **N available dentists = N parallel appointments at the same
time.** Capacity expands automatically with the ready roster and shrinks when a dentist is Not Ready —
nothing about the dentist count is hardcoded (migration 0021 + `fn_available_dentist_ids` 0029).

## 2. Presence model (Ready / Not Ready)
Per dentist, per clinic date (`dentist_ready`, UNIQUE(dentist_id, clinic_date)). Semantics: an active
dentist counts available **unless** a `ready=false` row exists for that date; a `ready=true` row makes
today explicit; rows expire with the day. Ready-state is NOT a permanent account property — a dentist
must re-confirm readiness each day. Deactivated dentists are never ready and can never receive an
appointment (guard triggers). Doctor UI: prominent "Ready for Today / Not Ready" toggle on the doctor
calendar; deactivated accounts see it disabled.

## 3. Scheduling enforcement (DATABASE, not React)
`fn_appt_dentist_guard` runs on every appointment write: per-dentist overlap among reservations
(`payment_status in (pending,paid)`, not cancelled); auto-assigns the **least-loaded ready dentist**
(tie-break: dentist id) under a per-day advisory lock so concurrent bookings can never share a dentist;
an explicitly supplied `dentist_id` is validated (availability + overlap); no candidate →
"no dentist available for that time". The UI only displays capacity — it cannot create a double
booking. Proven by capacity_qa (a)–(j): zero-ready blocked, 1/2/3-dentist parallel bookings, 90-minute
visit conflict scoping, **two concurrent inserts → exactly one wins**, deactivation guards, forged
`dentist_id` rejected. Patients never choose a dentist.

## 4. Payment webhook retry correctness
`provider_events` now distinguishes **received** from **processed** (`processed_at` nullable, no
auto-stamp — it was `NOT NULL DEFAULT now()`, the root cause of lost retries). A transient failure
(provider unsettled, provider read error) returns 5xx and leaves the event unprocessed; the provider's
retry of the SAME event id re-processes it; only a successful settle stamps processed; duplicates after
processing are acknowledged no-ops; settlement idempotence makes races safe. Mandatory regression
(pay_webhook_qa W12): first delivery 500+unprocessed → same event reprocesses → paid + exactly one
transaction + exactly one notification + processed → later duplicate harmless. 27/27.

## 5. Payment / notification deep links
Payment rows carry route `/appointments?appt=<id>` with deterministic dedupe keys; in-app notification
rows mark read AND navigate to their stored route; the target screen renders scoped + highlighted;
unknown/foreign/stale routes render safely with zero private data; deep links never grant access
(auth + RLS unchanged, unauthorized appointment IDs blocked). Duplicate events → one notification;
refresh-safe; closed-PWA push click → focus + navigate (notification_qa 12/12, push_qa checks 28/29b).

## 6. Finance correction model (Create → Review → Correct/Void → Audit)
`fn_correct_transaction` (amount + mandatory reason, owner-only) and `fn_void_transaction`
(timestamped, idempotent, owner-only) — never a silent history edit. Corrected rows show
"Corrected from ₱old, reason"; voided rows are struck through and excluded from every income total
(totals recompute proven). Owner UI modals surface RPC errors (invalid amount, already voided).
finance_qa 26/26.

## 7. Audit log coverage
`audit_log` gains before/after state, actor role, and reason (migration 0022). Service/price changes,
dentist de/activations, transaction corrections and voids all log with actor + timestamp + readable
before→after summaries. Owner-facing Audit Log screen (`/owner/audit`) with action/entity/actor
filters. Append-only RLS: patients can neither read, insert, modify, nor delete (insert policy
tightened to `with check(false)` in 0027). audit_qa 18/18.

## 8. Legacy / stale state removed
Receipt-upload flow remnants, stale hardcoded clinic hours ("10 AM – 5 PM") and dentist email
fallbacks ("Clinic hours unavailable" instead of a possibly-wrong schedule), stale receipt copy in the
visit-complete notification. Repo-wide sweep: zero leftovers. QA data hygiene: all QA patients/
transactions/dentists rows removed (21 test transactions, QA patients, orphan sweep — zero left).

## 9. Push QA cleanup precision
`push_qa` no longer deletes by user: cleanup is **endpoint-scoped** to the subscription endpoints the
run created (device A, device B, forge rows) plus id-scoped notification cleanup. Prior checks intact;
device-B registration settle now polls the server row instead of a blind wait. 33/33 locally and on
production.

## 10. Test evidence (final gate)
| Suite | Result | Suite | Result |
|---|---|---|---|
| qa_all | 35/35 | capacity_qa (NEW) | 33/33 |
| journey_qa | 42/42 | finance_qa (NEW) | 26/26 |
| nav_matrix | 21/21 | audit_qa (NEW) | 18/18 |
| prod_e2e | 20/20 | notification_qa (NEW) | 12/12 |
| fidelity_e2e | 26/26 | pay_security | 14/14 |
| cross_role_qa | 22/22 | pay_smoke | 13/13 |
| ehr_qa | 16/16 | pay_lifecycle | 7/7 |
| ehr_link_qa | 7/7 | pay_webhook_qa | 27/27 |
| scheduling_qa | 10/10 | push_qa (local + prod) | 33/33 ×2 |
| catalog_prices_qa | 14/14 | **Total** | **365 local + 55 prod** |

Fixes found by this gate: patient capacity slots (patients get 0 rows from `dentists` by design →
`fn_available_dentist_ids` RPC + shared-helper fallback), journey D3 re-pinned to multi-dentist truth
(calendar visibility must match the auto-assignment; the old flake is structurally gone).

## 11. Security posture
Payments: webhook is the sole authority, signature enforced, mode fail-closed (mock/test/live explicit,
never inferred), amount+currency verified before PAID, secret keys server-side only. RLS: EHR
owner+doctor only; patients cannot self-confirm, self-price, or write income/audit rows; `dentists`
rows never leak to patients (id-only RPC surface); deactivated doctors receive nothing. Repo and
deployed bundle secret scans clean.

## 12. Honest limitations (NOT verified)
- **Physical Android/iPhone push acceptance** — no devices attached; the full chain is automated-green
  on production but real-device delivery is unverified.
- **Live ₱1 PayMongo smoke** — mode is `test`; the live QR expired un-scanned. Re-arm playbook ready.
- No offline/bandwidth testing, no Play Store distribution (PWA install only).
- `journey_qa` runs best sequentially — concurrent suite runs against the same DB corrupt each other
  (observed once; suites are green standalone/in-sequence).
