# DentalVibe — Dental Clinic App

Full-stack dental clinic management app for our SF capstone: appointments, patients, income, staff, with a **Patient**, **Doctor**, and **Doctor Owner** portal in one PWA.

🔗 **Live (Vercel):** https://dentalvibe.vercel.app

> Every push to `main` auto-deploys. Give Vercel ~1–2 min after merging.

## Stack

- **Frontend:** React 18 + Vite 6 + Tailwind CSS 3
- **Backend:** Express (Node)
- **Database/Auth:** Supabase

## Run it on your machine

You need **Node.js 18+** (check with `node -v`).

```bash
# 1. clone
git clone https://github.com/AttilaHuns288452/dentalvibe.git
cd Dental-Clinic

# 2. frontend
cd frontend
npm install

# 3. Supabase keys (one-time) — see "Supabase keys" below
cp .env.example .env.local
# then paste the keys into .env.local (ask Attila for the values)

# 4. start
npm run dev
```

Open **http://localhost:5173**. That's it — the backend is only needed for API features later (`cd backend && npm install && npm run dev` → port 3000).

## Supabase keys

`frontend/.env.local` is **gitignored** — never commit it. It needs two values:

```
VITE_SUPABASE_URL=https://wfmtkmfevdqbhtpqamic.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_FXP8LIDjDFZ5yN53jy2F7w_xVcIokw_
```

Both are **publishable browser values** — safe to expose (the site ships them to every visitor), data is protected by Row Level Security. If these ever stop working, grab fresh ones: [supabase.com](https://supabase.com) → project **DentalVibe** → ⚙️ Project Settings → **API**.

## Trying the app

At the top there's an amber **dev role bar** (temporary, removed when real auth lands):

- **Login as User** → Patient portal (5-tab bottom nav)
- **Login as Doctor** → Dentist portal (4-tab nav)
- **Login as Doctor Owner** → Owner portal (Home · Calendar · Manage · Patients · Income · Staff)

All screens show placeholder pages for now; the navbar, routing, and role switching are the working foundation.

## Pushing your work

We keep `main` deployable — always branch + PR:

```bash
git checkout -b your-name/what-you-did
# ...make changes...
git add -A && git commit -m "frontend: short description"
git push -u origin your-name/what-you-did
```

Then open a Pull Request on GitHub and have someone review it. **Never push straight to `main`.**

Before opening a PR, make sure it builds:

```bash
cd frontend && npm run build
```

## Project structure (frontend)

```
frontend/src/
├── App.jsx              # shell: role provider + dev switcher + navbar + hash router
├── context/RoleContext.jsx    # current role (patient/doctor/owner) — auth later plugs in here
├── navigation/
│   ├── navConfig.jsx    # per-role bottom-tab items (edit menus here)
│   ├── Navbar.jsx       # top app bar + bottom tab bar + chat bubble
│   ├── RoleSwitcher.jsx # DEV-ONLY login buttons — delete when Supabase auth lands
│   └── useHashPath.js   # tiny hash router hook
├── pages/Placeholder.jsx # "coming soon" screen used by every route for now
└── supabaseClient.js    # Supabase client (reads the VITE_SUPABASE_* env vars)
```

## Backend

```
cd backend && npm install && npm run dev   # localhost:3000
```

Health check: http://localhost:3000/api/health
