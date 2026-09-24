import { ROLES } from '../context/RoleContext'

// Role-based bottom-tab config, straight from the Figma frames (SF Dental.pdf).
// Owner = the new navbar (Requests tab removed, Manage added) + chat FAB.

export const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-6h6v6',
  cal: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a1.9 1.9 0 0 0 3.4 0',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M19.4 15a1.7 1.7 0 0 0 .34 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.34 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.34-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.34h.08a1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51h.08a1.7 1.7 0 0 0 1.82-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.82v.08a1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  wallet: 'M3 6h18v13H3zM3 10h18M16 14.5h2',
  shield: 'M12 3l8 3v6c0 4.5-3 8-8 10-5-2-8-5.5-8-10V6zM9 12l2 2 4-4',
  chat: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c0-4 3.6-6 8-6s8 2 8 6',
}

export const NAV_BY_ROLE = {
  // Patient portal — 5 tabs (frames 03–08)
  [ROLES.PATIENT]: [
    { label: 'Home', path: '/', icon: 'home' },
    { label: 'Appointments', path: '/appointments', icon: 'cal' },
    { label: 'Book', path: '/book', icon: 'plus' },
    { label: 'Messages', path: '/messages', icon: 'chat' },
    { label: 'Profile', path: '/profile', icon: 'user' },
  ],
  // Staff dentist — same bar minus Income/Staff (permissions); Requests removed
  // like the owner navbar (booking requests surface from the home banner instead)
  [ROLES.DOCTOR]: [
    { label: 'Home', path: '/doctor', icon: 'home' },
    { label: 'Calendar', path: '/doctor/calendar', icon: 'cal' },
    { label: 'Patients', path: '/doctor/patients', icon: 'users' },
    { label: 'Messages', path: '/doctor/messages', icon: 'chat' },
  ],
  // Owner — Home·Calendar·Manage·Patients·Income·Staff (new navbar, no Requests tab)
  [ROLES.OWNER]: [
    { label: 'Home', path: '/owner', icon: 'home' },
    { label: 'Calendar', path: '/owner/calendar', icon: 'cal' },
    { label: 'Manage', path: '/owner/manage', icon: 'gear' },
    { label: 'Patients', path: '/owner/patients', icon: 'users' },
    { label: 'Income', path: '/owner/income', icon: 'wallet' },
    { label: 'Staff', path: '/owner/staff', icon: 'shield' },
  ],
}
