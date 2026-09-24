import { createContext, useContext, useEffect, useState } from 'react'
import { getSession, getProfile, getMyPatientRecord, listAppointments, signOut, supabase } from '../lib/api'

// Real Supabase session. Role comes from profiles table (set at signup).
// Staff accounts are provisioned by the clinic owner, not public signup.

const AuthContext = createContext(null)

export const ROLES = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  OWNER: 'owner',
}

export function RoleProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [patientRecord, setPatientRecord] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [deactivated, setDeactivated] = useState(false)

  const hydrate = async () => {
    const s = await getSession()
    setSession(s)
    if (!s?.user) {
      setProfile(null)
      setPatientRecord(null)
      setPendingCount(0)
      return
    }
    // profile first — never null it because a secondary fetch hiccuped
    let p = null
    try {
      p = await getProfile(s.user.id)
      setProfile(p)
    } catch {
      setProfile(null)
      return
    }
    // BUG-005 fix: dentists.active is authorization, not decoration
    setDeactivated(false)
    if (p?.role === 'doctor' || p?.role === 'owner') {
      const { data: d } = await supabase.from('dentists').select('active').eq('email', s.user.email).limit(1)
      if (d?.[0]?.active === false) setDeactivated(true)
    }
    try {
      if (p?.role === 'patient') {
        const rec = await getMyPatientRecord(s.user.id)
        setPatientRecord(rec)
        if (rec?.id) {
          const mine = await listMyAppointments(rec.id)
          setPendingCount(mine.filter((a) => a.status === 'pending').length)
        }
      } else {
        setPatientRecord(null)
        const all = await listAppointments()
        setPendingCount(all.filter((a) => a.status === 'pending').length)
      }
    } catch {
      setPendingCount(0) // secondary data failed — app still usable
    }
  }

  useEffect(() => {
    hydrate().finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await signOut()
    setSession(null)
    setProfile(null)
    setPatientRecord(null)
    setPendingCount(0)
  }

  return (
    <AuthContext.Provider value={{ session, profile, patientRecord, pendingCount, loading, deactivated, refresh: hydrate, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useRole() { const { profile } = useAuth(); return { role: profile?.role, user: { name: profile?.full_name } } }

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <RoleProvider>')
  return ctx
}
