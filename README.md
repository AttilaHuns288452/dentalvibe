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

## Demo accounts (password `password123`)

| Role | Email |
|---|---|
| Patient | `maria@dentalvibe.ph` (also juan/andrea/liza/carlo @dentalvibe.ph) |
| Doctor | `doctor@dentalvibe.ph` |
| Owner | `owner@dentalvibe.ph` |

**QA tools:** open `https://dentalvibe.vercel.app/?dev=1` — a DEV pill gives one-tap role logins and a **simulated PayMongo test payment** button (runs the real payment pipeline — create → provider settle — so it lands in Owner → Income Analytics). `src/lib/dev.js` is the one file to strip for a real clinic launch.

## Product rules (enforced in the DB, not just the UI)

- Booking: pick services → date → time → **appointment fee (deposit) via PayMongo dynamic QR Ph** → patient scans with GCash/Maya/bank app → PayMongo webhook confirms → the appointment is **confirmed automatically**. The fee reserves the slot (pending payments hold it) — treatment is billed at the clinic. Payment is settled ONLY by the signed provider webhook/status read — never by a receipt screenshot. Secrets stay server-side (Supabase Edge Functions `paymongo-create` / `paymongo-webhook` / `paymongo-check`); without PayMongo keys the app runs a clearly-labeled **mock provider** with the identical state machine. Payment modes (`payment_provider_config.provider_mode`): **mock** (no keys, simulated settle) · **test** (PayMongo test keys — dynamic QR Ph + the documented `test_url` simulation) · **live** (real money, webhook-only settle). In-store QRPh (static merchant standee) is supported via `qr_style: 'instore'` + `merchant_qr_image` for the controlled ₱1 live smoke test.
- A paid appointment holds its exact slot (unique index); double bookings are rejected.
- Patients can edit only their contact info + booking notes, or cancel a pending booking. Identity/clinical fields are clinic-managed (staff-only `medical_note`, private attachments).
- EHR clinical documents (`ehr_attachments` + private `ehr-files` bucket) are Owner/Doctor-only — enforced in RLS, not UI. Upload categories are configurable (Owner → Manage → Record Categories); deactivated categories stay on historical records, uploads are versioned (newest per category = LATEST, nothing overwritten).
- Income Analytics = paid appointments + walk-in ledger entries − expenses.

## QA / tests (in `frontend/`)

```bash
node qa_all.mjs      # role navbar + CRUD + chat + prices + income (31 checks)
node prod_e2e.mjs    # payment gate, auto-confirm, RLS (19 checks)
node journey_qa.mjs  # full patient+doctor+owner journeys (42 checks)
node live_demo.mjs   # 3-role live business scenario (21 checks)
node verify_fixes.mjs# security attack battery (24 probes)
node shots_v3.mjs    # re-capture screenshots/
```

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
