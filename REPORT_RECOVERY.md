# DentalVibe — Crash / Restart / App-Kill Recovery: Audit Report

Repo `AttilaHuns288452/dentalvibe` · main @ `76f807b` · live https://dentalvibe.vercel.app

## What already survives correctly (verified — left alone, §18)
The architecture is server-authoritative; there is **no unload-time persistence anywhere**
(audited: the only `beforeunload` handler warns about dirty forms; nothing is flushed, queued,
or written on kill). Every business record is written to Supabase at mutation time.

| Event | Login (per-tab design) | Form drafts | Business data (appointments, payments, transactions, audit, messages, notifications, Ready) |
|---|---|---|---|
| Refresh / reload | **survives** (sessionStorage persists in-tab) | **survives** (`useStickyState`) | **survives** (refetched from DB on mount) |
| Back / Forward | survives | survives (sessionStorage) | survives (pages refetch on mount) |
| Tab close | lost (re-login) — **intentional** (§17) | lost | survives (DB) |
| Browser restart | lost (re-login) | lost | survives |
| PWA close / reopen | lost (re-login) | lost | survives |
| Device restart | lost (re-login) | lost | survives |

Rehydration (§8): every screen loads from Supabase on mount (`api.js`: "components fetch on
mount, refresh on action"); `useRevalidateOnVisible` refetches when the tab becomes visible;
React state is never the authority. Verified in recovery_qa cases 2/3/8/12/13/19/20.

## Duplicate-submission protection after a crash (§10) — all DB-enforced
- duplicate **appointment**: `ux_appt_patient_date` (one pending/approved booking per patient
  per day) + per-dentist overlap guard — verified rejected after crash-retry.
- duplicate **payment**: `payments_active_pending` (one pending payment per appointment) +
  reuse-first in `paymongo-create` — a crash-retry returns the **same payment id**, exactly one row.
- duplicate **financial transaction**: `transactions_one_per_payment` (one per payment) +
  settlement idempotence (`fn_apply_payment_result` no-ops re-settles) — exactly one transaction
  and one notification after retries.
- duplicate **correction**: **fixed this pass** — see below.
- duplicate **void**: already idempotent (`fn_void_transaction` silent no-op when voided) — verified.
- webhook duplicates: `provider_events` PK + first-delivery semantics — verified.

## The race (§9) — "server mutation succeeds, client dies before the response/UI"
Tested directly (recovery_qa cases 1/2/5/7/8/14/15/17): the committed mutation is visible from a
**fresh session** with no UI ever shown, and the client's retry cannot double-apply. The payment
flow is the strongest case: confirmation is driven by **server state** (BookSuccess polls the
payment row), so a killed browser can never leave a paid-but-unconfirmed business record.

## Crash/restart bugs found and fixed
1. **Duplicate correction double-apply** (the only real gap): if the client died after
   `fn_correct_transaction` succeeded, a retry applied the correction **again** (second audit row).
   Fixed (migration `0038`): a correction to the SAME amount is a semantic no-op. Different-amount
   re-corrections still work; error strings preserved (`correction reason required`, `invalid
   amount`, `transaction is voided`).
2. **0038 recreation drift** (self-inflicted during the fix, caught by suite): the recreated
   function called the trigger-signature `fn_audit(...)` and renamed an error string — restored the
   real `fn_audit_reason(...)` call and original messages.
3. **Test-layer fragility around provider settle lag** (not product bugs): PayMongo test-API
   settle latency is variable (~seconds); three suites asserted instantly. Hardened: pay_security
   Sunday-safe date, pay_smoke settle-poller, pay_webhook W1 same-event retry (which is the
   design's own retry semantics). `paymongo-check` is a status lookup and correctly reports
   `pending` under lag — left alone per §18.

## Intentionally lost on termination (documented policy, not bugs)
- **Login on tab close / app kill / browser restart** — sessions are per-tab `sessionStorage` by
  explicit design (one tab can never flip another tab's account). Not changed (§17).
- **In-progress form drafts on tab close** — drafts persist only via `sessionStorage`
  (`useStickyState`); on refresh/back they survive, on tab close they are gone. A dirty form shows
  a browser "leave site?" warning (`useUnsavedGuard`) before refresh/close.
- Nothing else: no partially-applied mutations, no half-payments, no orphaned UI-only state that
  affects business data.

## Tests added / run
**NEW — `frontend/recovery_qa.mjs`, 20/20** (kill-before-UI, rehydrate, duplicate-protection,
correction/void crash-retries, UI restart without the confirmation page):
```
1 booking committed then client died            11 one notification after retries
2 reopened app finds the booking                12 message survives reopen
3 booking in patient list after reopen          13 settings atomic + committed value
4 duplicate booking REJECTED                    14 correction committed (then died)
5 payment retry returns SAME payment            15 same-amount retry = no-op (1 audit row)
6 exactly ONE payment row                       16 different-amount correction still works
7 settle committed (then died)                  17 void retry safe no-op
8 reopened app shows PAID/APPROVED from DB      18 one void audit row
9 re-settle idempotent (no second apply)        19 Ready refetched from DB after reopen
10 one transaction after retries                20 UI restart lists booking, no confirmation needed
```
**Regression after the fixes:** finance_qa 28/28 · audit_qa 41/41 · pay_security 14/14 ·
pay_webhook_qa 27/27 · pay_smoke 13/13 · qa_all 35/35 · journey_qa 42/42 · build PASS.

## Limitations requiring real physical devices
- **PWA kill/reopen and device restart on Android/iPhone: not performed** (no devices attached).
  The web-equivalent (context/browser kill + fresh session) is covered; per-tab session loss on
  kill is by design and behaves identically in a PWA shell.
- Real "process kill during a fetch" at the OS level on mobile (radio drop mid-request) is
  represented by the client-abandonment model above; server-side, any in-flight mutation either
  commits atomically or not at all (single-row PostgREST writes, guarded RPCs).

## Scope notes (§15-16)
No offline mutation queue, background sync, local database, or persistence rewrite was introduced.
No security or session-storage design was changed. The audit-only additions: one idempotence guard
in `fn_correct_transaction`, one new QA suite, and test-fixture hardening.
