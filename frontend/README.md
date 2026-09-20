# Dental Clinic

React + Tailwind CSS dental clinic management app.

## Stack

- **React 18** — UI library
- **Tailwind CSS 3** — utility-first styling
- **Vite 6** — build tool & dev server

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server (opens at localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
frontend/src/
├── App.jsx              # App shell: role provider + dev role switcher + navbar + hash router
├── main.jsx             # React mount point
├── index.css            # Tailwind imports + base styles
├── supabaseClient.js    # Supabase client (VITE_SUPABASE_* env vars, see .env.example)
├── context/
│   └── RoleContext.jsx  # Current role + mock user (swap internals for Supabase auth later)
├── navigation/
│   ├── navConfig.jsx    # Per-role navbar menu items (patient / doctor / owner)
│   ├── Navbar.jsx       # Top navbar, renders items for the active role
│   └── RoleSwitcher.jsx # DEV-ONLY "Login as …" buttons — delete when real auth lands
└── pages/
    ├── Home.jsx         # Role-aware home (owner gets KPI cards)
    ├── Placeholder.jsx  # Generic stub for not-yet-built routes
    └── owner/
        └── OwnerManage.jsx  # Manage screen (clinic profile, services & pricing)
```

## Tailwind Customization

Edit `tailwind.config.js` to add custom colors, fonts, or spacing. The `primary` palette is pre-configured with a blue theme.
