# DentalVibe — Final Hardening / Release Gate: Report

Repo `AttilaHuns288452/dentalvibe` · main @ `87fdb4f` · live https://dentalvibe.vercel.app (bundle `index-DiHJzYBm.js`) · DB `wfmtkmfevdqbhtpqamic`

## Commits
| SHA | Summary |
|---|---|
| `1eb3409` | Release gate: Ready null-semantics, audit RLS forgery path, finance delete removal, README correction, legacy scan, +9 gate regression checks |
| `87fdb4f` | pay_smoke Sunday-safe fixture (random test date drew a closed day) |
| (context) | `b369c47` previous release report; `0033_release_gate_rls.sql` + `0034/0035/0036` policy iterations captured in `0033` |

## Fixes completed
1. **Ready null-state semantics (§1):** `null` (fresh day) and `false` both render **Not Ready**; the
   button always sets the OPPOSITE of readiness (was: a fresh-day click set `false` — backwards);
   button text unambiguous (`Ready for Today` ↔ `Not Ready`); explicit state chip
   (`Today's presence · Ready|Not Ready`). Owner ops `nReady` counts **only `ready === true`**
   (a scheduled dentist who hasn't checked in never inflates the Ready count: "3 scheduled · 0 Ready"
   is now what shows). Doctor + Owner panels both fixed. Booking capacity untouched.
2. **Daily reset / Manila dates (§2):** verified — `dentist_ready` rows are keyed by Manila clinic
   date (`UNIQUE(dentist_id, clinic_date)`); ready_state_qa proves today's Ready ≠ tomorrow's Ready
   and the UI reads/writes the Manila date only (no browser-timezone source).
3. **Audit RLS forgery path (§3):** `audit insert definer` (WITH CHECK **TRUE**) ORed past the deny
   policy — **any authenticated client could forge audit rows**. Every INSERT policy dropped by
   discovery (0033); final state: zero client INSERT policies (default deny) while
   SECURITY-DEFINER trigger generation keeps working; Owner read preserved; UPDATE/DELETE have no
   policies = denied. Verified live: patient/doctor/owner direct INSERT → 42501; owner UPDATE/DELETE
   → 0 rows; trigger writes still produce correct before/after rows.
4. **Finance hard-delete removal (§5):** `transactions owner delete` **and** the DELETE half of
   `transactions owner all` removed. Caught and fixed a self-inflicted regression on the way: the
   removed ALL policy had bundled SELECT, which broke `INSERT … RETURNING` and owner finance reads —
   `transactions owner read` restored explicitly. Final: owner INSERT/UPDATE only, **no DELETE for
   any client role** (maintenance deletes = service role/SQL only). Verified: owner delete on a real
   row → row survives; patient/doctor delete → no-op.
5. **README/documentation (§14):** the "one shared visit schedule / booking never assigns a chair or
   doctor / parallel chairs later" section replaced with the real model (work schedules → auto
   assignment → per-dentist overlap → parallel capacity; Ready = day-of ops only). Per-dentist slot
   bullet corrected.
6. **Legacy scan (§15):** dead `/receipt` route mapping removed from Navbar; live_demo's stale
   "receipt" UI expectation updated to the current "Completed" copy; audit-policy note added to
   migration 0033; no hardcoded hours, no machine paths, no dev shortcuts, no dev credentials found.
7. **PayMongo webhook retry (§7):** preserved and re-verified — mandatory regression green
   (first delivery 500 + unprocessed → same event reprocesses → paid + 1 transaction + 1 notification
   + processed → duplicates harmless). Multi-dentist (§8) and Ready-vs-future separation (§9)
   re-verified: capacity only from `dentist_work_schedules`, future booking works with zero Ready
   rows, N scheduled = N parallel, concurrency = exactly one winner per dentist.

## QA (exact counts, every suite actually executed)
```
Build:                       PASS (vite build, no dev panel in bundle)
Capacity QA:                 40/40
Ready-state QA:              15/15
Owner ops QA:                38/38   (incl. new fresh-day UI state machine 6e-6h)
Finance QA:                  28/28   (incl. new owner/patient delete-denial checks)
Audit QA:                    41/41   (incl. new patient/doctor/owner insert-denial + update/delete checks)
Notification QA:             12/12
General QA (qa_all):         35/35
Journey QA:                  42/42
Navigation matrix:           21/21
Production E2E:              20/20
Figma fidelity E2E:          26/26
Security (pay_security):     14/14
Scheduling QA:               10/10
EHR QA:                      16/16
EHR link QA:                  7/7
Catalog/prices QA:           14/14
Cross-role QA:               22/22
PayMongo lifecycle:           7/7
PayMongo webhook QA:         27/27   (incl. transient-retry regression W12)
Push QA:                     33/33
PayMongo smoke:              13/13
────────────────────────────────────
Full local regression:      481/481  (0 failures)
Production (live site):      55/55   (cross-role 22 + push 33)
Total:                      536/536
```

## Remaining limitations
**Verified:** everything in the table above (all automated, run against local build AND the deployed
production site for cross-role + push).
**Automated but NOT physical-device verified:**
- Physical Android verification: **not performed**
- Physical iPhone verification: **not performed**
  (no devices attached to this machine; the full push chain is automated-green on production).
**Intentionally out of scope:** appointment reminders, inventory, odontogram, billing/invoicing,
enterprise HR/presence, live ₱1 PayMongo smoke (provider mode = `test`; live-qr re-arm playbook
documented), offline/bandwidth testing, app-store distribution (PWA install only).

## Final repository state
- **No known blocking correctness issue found.**
- **No client audit-forgery path:** direct INSERT denied for every role; audit rows come only from
  trusted SECURITY-DEFINER triggers with correct actor/before/after/reason.
- **No direct financial delete path:** no client role can hard-delete transactions; Correct/Void +
  audit are the only mutation routes; payment-linked exactly-once accounting intact (correction
  creates no new payment/transaction and never touches PayMongo settlement state).
- **Ready semantics correct:** fresh day = Not Ready; explicit "Ready for Today" required; button
  labels correct in every state; Ready never touches booking capacity.
- **Future booking independent of Ready:** capacity derives solely from `dentist_work_schedules`.
- **Multi-dentist capacity remains database-enforced:** per-dentist overlap + least-loaded
  auto-assignment + advisory-lock concurrency; no hardcoded dentist counts.
- **Documentation matches implementation** (README + migrations + code comments).
- Migrations 0001→0033 present, ordered, and captured; repo + deployed bundle secret scans clean;
  QA debris swept (no QA patients/transactions/subscriptions left).
