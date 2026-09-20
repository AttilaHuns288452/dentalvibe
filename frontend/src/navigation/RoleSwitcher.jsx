import { NAV_BY_ROLE } from './navConfig'
import { useRole } from '../context/RoleContext'

const LABELS = {
  patient: 'Login as User',
  doctor: 'Login as Doctor',
  owner: 'Login as Doctor Owner',
}

// ponytail: dev-only role switcher — delete this component (and its <RoleSwitcher/>
// usage in App.jsx) when real Supabase auth lands; nothing else references it.
export default function RoleSwitcher() {
  const { role, setRole } = useRole()
  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-md mx-auto px-4 py-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Dev role:</span>
        {Object.keys(NAV_BY_ROLE).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={
              'text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ' +
              (role === r
                ? 'bg-amber-200 border-amber-400 text-amber-900'
                : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-100')
            }
          >
            {LABELS[r]}
          </button>
        ))}
      </div>
    </div>
  )
}
