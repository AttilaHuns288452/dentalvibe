import { createContext, useContext, useEffect, useState } from 'react'

// ponytail: dev-only mock session. Real Supabase auth later: make this provider
// read supabase.auth.getSession() + role from the profiles table; keep the same
// { role, user, setRole } shape and no consumer changes needed.

export const ROLES = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  OWNER: 'owner',
}

const MOCK_USERS = {
  [ROLES.PATIENT]: { name: 'Maria Santos', id: 'DAR-0012' },
  [ROLES.DOCTOR]: { name: 'Dr. Miguel Ramos', id: 'DR-0007' },
  [ROLES.OWNER]: { name: 'Dr. Dulce Amor R. Joson', id: 'OWNER' },
}

const STORAGE_KEY = 'dc_role'

const RoleContext = createContext(null)

export function RoleProvider({ children }) {
  const [role, setRole] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return Object.values(ROLES).includes(saved) ? saved : ROLES.PATIENT
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, role)
  }, [role])

  return (
    <RoleContext.Provider value={{ role, setRole, user: MOCK_USERS[role] }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used inside <RoleProvider>')
  return ctx
}
