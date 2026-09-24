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

**QA tools:** open `https://dentalvibe.vercel.app/?dev=1` — a DEV pill gives one-tap role logins and a **mock GCash payment** button (runs the real payment RPC so it lands in Owner → Income Analytics). `src/lib/dev.js` is the one file to strip for a real clinic launch.

## Product rules (enforced in the DB, not just the UI)

- Booking: pick services → date → time → **appointment fee (deposit) via QR** → the slot is secured and the appointment is **confirmed instantly**. The fee reserves the slot — treatment is billed at the clinic.
- A paid appointment holds its exact slot (unique index); double bookings are rejected.
- Patients can edit only their contact info + booking notes, or cancel a pending booking. Identity/clinical fields are clinic-managed (staff-only `medical_note`, private attachments).
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
