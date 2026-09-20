import { createContext, useContext, useEffect, useState } from 'react'
import { getSession, getProfile, getMyPatientRecord } from '../lib/api'

// Real Supabase session. The dev RoleSwitcher still exists for teammate testing:
// it signs in as seeded demo accounts (owner@/doctor@) or a mock patient view.

export const ROLES = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  OWNER: 'owner',
}

const AuthContext = createContext(null)

export function RoleProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [patientRecord, setPatientRecord] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession()
      .then(async (s) => {
        setSession(s)
        if (s?.user) {
          const p = await getProfile(s.user.id)
          setProfile(p)
          if (p?.role === 'patient') setPatientRecord(await getMyPatientRecord(s.user.id))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const refresh = async () => {
    const s = await getSession()
    setSession(s)
    if (s?.user) {
      const p = await getProfile(s.user.id)
      setProfile(p)
      if (p?.role === 'patient') setPatientRecord(await getMyPatientRecord(s.user.id))
    } else {
      setProfile(null)
      setPatientRecord(null)
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, patientRecord, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <RoleProvider>')
  return ctx
}

// ponytail: legacy alias so older components keep compiling
export const useRole = () => {
  const { profile } = useAuth()
  return { role: profile?.role, user: { name: profile?.full_name } }
}
