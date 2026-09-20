import { useNavigate } from 'react-router-dom'
import { NAV_BY_ROLE } from './navConfig'
import { useAuth, ROLES } from '../context/RoleContext'
import { signIn, signOut } from '../lib/api'

const DEMO = {
  owner: { email: 'owner@dentalvibe.ph', label: 'Login as Doctor Owner' },
  doctor: { email: 'doctor@dentalvibe.ph', label: 'Login as Doctor' },
}

// DEV-ONLY switcher. Real logins for owner/doctor (seeded demo accounts);
// patient is the signed-up account you created. Delete when auth UI is final.
export default function RoleSwitcher() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const switchTo = async (roleKey) => {
    if (profile?.role === roleKey) return
    await signOut()
    if (roleKey === 'patient') {
      navigate('/') // patient signs in via Register/Login form
      window.location.reload()
      return
    }
    try {
      await signIn(DEMO[roleKey].email, 'password123')
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-md mx-auto px-4 py-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Dev:</span>
        {Object.keys(NAV_BY_ROLE).map((r) => (
          <button key={r} onClick={() => switchTo(r)}
                  className={'text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ' +
                    (profile?.role === r
                      ? 'bg-amber-200 border-amber-400 text-amber-900'
                      : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-100')}>
            {{ patient: 'User', doctor: 'Doctor', owner: 'Owner' }[r]}
          </button>
        ))}
        <span className="text-[10px] text-amber-600 ml-auto">demo pw: password123</span>
      </div>
    </div>
  )
}
