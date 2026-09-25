# D.A.R. Dental Clinic — Appointment & Record System

Full-stack dental clinic management PWA (capstone): booking with QR payment, patient records (EHR), calendar, messaging, staff management, and income analytics — one app, three roles (Patient · Doctor · Owner).

🔗 **Live:** https://dentalvibe.vercel.app · every push to `main` auto-deploys (Vercel takes ~1–2 min).

## Stack

- **Frontend:** React 18 + Vite 6 + Tailwind CSS 3 (mobile-first 390×844, installable PWA)
- **Backend:** Supabase (Postgres + Auth + Storage) — all business rules enforced in the database (RLS, triggers, RPCs)

## Run locally

```bash
git clone https://github.com/AttilaHuns288452/dentalvibe.git
cd dentalvibe/frontend
npm install
cp .env.example .env.local   # paste the Supabase URL + anon key (ask Attila)
npm run dev                   # http://localhost:5173
```

`.env.local` is gitignored. Its two values are **publishable browser keys** — the site ships them to every visitor; data is protected by Row Level Security. Never commit `service_role` keys.

## Demo accounts

| Role | Email |
|---|---|
| Patient | `maria@dentalvibe.ph` (also juan/andrea/liza/carlo @dentalvibe.ph) |
| Doctor | `doctor@dentalvibe.ph` |
| Owner | `owner@dentalvibe.ph` |

Credentials are seeded by `seed.mjs` and kept out of this README — ask Attila.

**Dev tools never ship to production.** `src/lib/dev.js` + `DevPanel` are build-flag gated (`VITE_ENABLE_DEV_TOOLS=1`, set only in `.env.development`): a production build contains neither the demo logins nor the mock payment (verified by bundle grep in CI-style runs). QA settles payments the production way — provider confirmation via `paymongo-check` — no dev UI involved.

**QA** — fully portable: `cd frontend && npm install` installs everything the suites need, Playwright included (`frontend/qa_playwright.mjs` is the single resolver every suite imports — no globals, no machine-specific paths). Browser suites need an app under test; API suites hit the deployed Supabase directly. Suites create unique temporary rows and clean up. Full script matrix: [QA script matrix](#qa-script-matrix).

## Product rules (enforced in the DB, not just the UI)

- Scheduling capacity: the clinic runs **one shared visit schedule** (booking never assigns a chair or doctor). The database overlap guard is therefore global by design; parallel chairs later = add a resource column and make the guard per-resource.
- Booking: pick services → date → time → **pay for the selected service(s) in full via PayMongo dynamic QR Ph** → patient scans with GCash/Maya/bank app → PayMongo webhook confirms → the appointment is **confirmed automatically**. The payment IS the service payment (pending payments hold the slot). Payment is settled ONLY by the signed provider webhook/status read — never by a receipt screenshot. Secrets stay server-side (Supabase Edge Functions `paymongo-create` / `paymongo-webhook` / `paymongo-check`); without PayMongo keys the app runs a clearly-labeled **mock provider** with the identical state machine. Payment modes (`payment_provider_config.provider_mode`): **mock** (no keys, simulated settle) · **test** (PayMongo test keys — dynamic QR Ph + the documented `test_url` simulation) · **live** (real money, webhook-only settle). The automated In-store static-QR branch is **retired** (a static merchant QR cannot guarantee per-payment linkage); `qr_style: 'instore'` now returns an explicit error and dynamic QR is the only automated path (the physical standee may still be used for manual counter payments outside the flow).
- A paid appointment holds its exact slot (unique index); double bookings are rejected.
- Patients can edit only their contact info + booking notes, or cancel a pending booking. Identity/clinical fields are clinic-managed (staff-only `medical_note`, private attachments).
- EHR clinical documents (`ehr_attachments` + private `ehr-files` bucket) are Owner/Doctor-only — enforced in RLS, not UI. Upload categories are configurable (Owner → Manage → Record Categories); deactivated categories stay on historical records, uploads are versioned (newest per category = LATEST, nothing overwritten).
- Income Analytics = paid appointments + walk-in ledger entries − expenses.

## QA script matrix

Run suites from `frontend/` unless noted. `:4176` = hardcoded `http://localhost:4176` — serve it first (e.g. `npm run preview -- --port 4176`). `QA_BASE` = env override where the target column says so. Counts = probe call sites in the script; one result is printed per executed probe (error paths may print fewer).

npm scripts (from `frontend/`):

| script | runs |
|---|---|
| `npm run qa` | `qa_all.mjs` + `journey_qa.mjs` |
| `npm run qa:e2e` | `prod_e2e.mjs` + `nav_matrix.mjs` + `fidelity_e2e.mjs` |
| `npm run qa:security` | `pay_security.mjs` |
| `npm run qa:cross-role` | `cross_role_qa.mjs` |

Browser suites (Playwright via `qa_playwright.mjs`):

| suite | covers | checks | target | extra |
|---|---|---|---|---|
| `qa_all.mjs` | role navbar + CRUD + chat + prices + income | 35 | `:4176` | |
| `journey_qa.mjs` | full patient + doctor + owner journeys | 42 | `QA_BASE` → live site | |
| `prod_e2e.mjs` | payment gate, auto-confirm, RLS | 20 | `:4176` | |
| `nav_matrix.mjs` | browser validity matrix (#43–56) + payment idempotency | 21 | `QA_BASE` → `:4176` | `SB_SECRET` |
| `fidelity_e2e.mjs` | Figma fidelity | 26 | `:4176` | |
| `cross_role_qa.mjs` | doctor lifecycle, clinic-settings propagation, pricing precedence | 23 | `QA_BASE` → `:4176` | `SB_SECRET` |
| `ehr_qa.mjs` | record categories + clinical-doc RLS | 16 | `QA_BASE` → `:4176` | |
| `ehr_link_qa.mjs` | EHR deep links + RBAC | 7 | `QA_BASE` → `:4176` | |
| `scheduling_qa.mjs` | scheduling derives from `clinic_settings` | 12 | `QA_BASE` → `:4176` | |
| `stress_roles.mjs` | per-role speed + cross-role interference | 20 | `QA_BASE` → `:4176` | `SB_SECRET` |
| `shots_responsive.mjs` | every route × 6 viewports × 3 roles → screenshots + audit JSON | — | `QA_BASE` → `:4176` | |
| `shots_spacing.mjs` | before/after spacing screenshots | — | `:4176` | |
| `stress_ui.mjs` | UI stress | 18 | live site | |

API suites (plain node against the deployed Supabase; `SB_SECRET` = service-role key):

| suite | covers | checks |
|---|---|---|
| `pay_security.mjs` | adversarial money-path + finance-linkage probes | 16 |
| `push_qa.mjs` | real Web Push chain (event → pg_net → dispatch → FCM → SW) + RLS + multi-device | 21 | `QA_BASE` + `SB_SECRET` + **`QA_CHROME`** (branded Chrome; headed + persistent profiles — unbranded Chromium cannot register push) | |
| `pay_webhook_qa.mjs` | webhook correctness + adversarial cases | 19 |
| `security_evidence.mjs` | S1/S2/S3/S5/S6 enforcement evidence | 13 |
| `verify_fixes.mjs` | purges orphan profiles + duplicate transactions, then re-runs the attack battery | 24 |
| `race_check.mjs` | concurrent double-verify race (5 rounds) | — |
| `stress_api.mjs` | API stress probes | 35 |
| `stress_api2.mjs` / `stress_api3.mjs` | API stress probes (console output only) | — |
| `seed.mjs` + `seed_map.mjs`, `cleanup.mjs`, `pretest_clean.mjs` | demo-data seed/cleanup (`seed_map.mjs` = single source of truth) | — |
| `qa_settle.mjs` | provider-side settle helper imported by suites | — |
| `e2e_flow.mjs` | legacy signup → book → chat flow | — |

Repo-root scripts (plain node):

| suite | covers | checks | needs |
|---|---|---|---|
| `pay_smoke.mjs` | mock-provider payment pipeline smoke | 13 | `SB_ANON` |
| `pay_sandbox.mjs` | PayMongo TEST-mode sandbox E2E | 13 | `SB_ANON` |
| `pay_race.mjs` | concurrent double-click → exactly one payment | — | `SB_ANON` |
| `live_demo.mjs` | 3-role live business scenario (browser) | 21 | `frontend/.env.local` |
| `shots_v3.mjs` | re-captures `screenshots/` (browser) | — | `OUT` optional |

Not listed: one-off debug probes (`probe_bugs.mjs`, `probe2.mjs`) and suites added by in-flight feature work. Corrections vs earlier docs: `qa_all` is 35 checks (was 31), `prod_e2e` is 20 (was 19), and the root `pay_*` scripts need `SB_ANON` (not `SB_SECRET`).

## Contributing

Keep `main` deployable — branch + PR (`your-name/what-you-did`), run `npm run build` before opening.

## Structure (frontend/src)

```
App.jsx                  shell: auth gate + routing + dev panel
context/RoleContext.jsx  session/role/unread-count/deactivated gate
navigation/              navConfig.jsx (per-role tabs) + Navbar
lib/                     api.js (all Supabase calls) · format.js · dev.js
pages/                   patient/ doctor/ owner/ shared/
supabase/migrations/     schema + RLS + triggers (source of truth for business rules)
```
