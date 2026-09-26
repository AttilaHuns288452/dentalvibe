import { NAV_BY_ROLE, ICONS } from './navConfig'
import { useAuth } from '../context/RoleContext'
import { useClinicName } from '../lib/hooks'
import { useLocation, useNavigate } from 'react-router-dom'

function TabIcon({ name, active }) {
  return (
    <svg viewBox="0 0 24 24" className={'w-6 h-6 ' + (active ? 'text-primary-600' : 'text-gray-500')} fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

function Sidebar({ links, activePath, navigate, roleBase, role, name, unreadCount }) {
  const clinicName = useClinicName()
  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-[72px] lg:w-60 flex-col bg-white border-r border-gray-200 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3 px-4 lg:px-5 h-14 flex-none">
        <span className="w-9 h-9 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
          </svg>
        </span>
        <div className="hidden lg:block min-w-0">
          <div className="text-sm font-bold text-gray-900 leading-tight truncate">{clinicName}</div>
          <div className="text-[11px] text-gray-500 leading-tight truncate capitalize">{role === 'patient' ? 'Patient Portal' : role === 'doctor' ? 'Dentist Portal' : 'Clinic Owner'} · {name}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 lg:px-3 py-2 space-y-1">
        {links.map((l) => {
          const active = l.path === activePath
          return (
            <button key={l.path} onClick={() => navigate(l.path)} title={l.label}
                    className={'w-full flex items-center gap-3 px-3 lg:px-4 h-11 rounded-lg ' + (active ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50')}>
              <TabIcon name={l.icon} active={active} />
              <span className={'hidden lg:inline text-sm ' + (active ? 'font-semibold' : '')}>{l.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex-none px-2 lg:px-3 py-3 space-y-1 border-t border-gray-100">
        <button onClick={() => navigate(roleBase + '/notifications')} title="Notifications"
                className="w-full flex items-center gap-3 px-3 lg:px-4 h-11 rounded-lg text-gray-600 hover:bg-gray-50 relative">
          <span className="relative w-6 h-6 flex items-center justify-center flex-none">
            <TabIcon name="bell" active={false} />
            {unreadCount > 0 && <span className="absolute -top-1 -right-2 min-w-[16px] h-4 rounded-full bg-primary-600 text-white text-[9px] font-bold flex items-center justify-center px-1">{unreadCount}</span>}
          </span>
          <span className="hidden lg:inline text-sm">Notifications</span>
        </button>
        <button onClick={() => navigate(roleBase + '/settings')} title="Settings"
                className="w-full flex items-center gap-3 px-3 lg:px-4 h-11 rounded-lg text-gray-600 hover:bg-gray-50">
          <TabIcon name="gear" active={false} />
          <span className="hidden lg:inline text-sm">Settings</span>
        </button>
      </div>
    </aside>
  )
}

export default function Navbar({ unreadCount = 0 }) {
  const clinicName = useClinicName()
  const { profile } = useAuth()
  const role = profile?.role
  const path = useLocation().pathname
  const navigate = useNavigate()
  const links = NAV_BY_ROLE[role] ?? []
  const matches = links.filter((l) => path === l.path || (l.path !== '/' && path.startsWith(l.path + '/')))
  // ponytail: sub-routes (EHR, pay, settings…) map to their parent tab per the Figma frames
  const SUFFIX_TAB = {
    '/ehr': 'Patients', '/notifications': 'Home', '/settings': 'Home',
    '/security': 'Profile', '/pay': 'Book',
  }
  const suffixHit = Object.entries(SUFFIX_TAB).find(([sfx]) => path.endsWith(sfx))
  const activePath = matches.sort((a, b) => b.path.length - a.path.length)[0]?.path
    ?? (suffixHit ? links.find((l) => l.label === suffixHit[1])?.path : undefined)
  const roleBase = role === 'patient' ? '' : '/' + role

  return (
    <>
      <Sidebar links={links} activePath={activePath} navigate={navigate} roleBase={roleBase} role={role} name={profile?.full_name} unreadCount={unreadCount} />
      <header className="bg-white border-b border-gray-200 md:hidden">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3 pt-[env(safe-area-inset-top)]">
          <a onClick={() => navigate(roleBase || '/')} className="cursor-pointer w-9 h-9 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-none">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
            </svg>
          </a>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 leading-tight">{clinicName}</div>
            <div className="text-[11px] text-gray-500 leading-tight capitalize">
              {role === 'patient' ? 'Patient Portal' : role === 'doctor' ? 'Dentist Portal' : 'Clinic Owner'}
              {' · '}{profile?.full_name}
            </div>
          </div>
          {/* bell (notifications) + gear (security), per the Figma headers — every role */}
          <button onClick={() => navigate(roleBase + '/notifications')} aria-label="Notifications"
                  className="relative w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-none">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.bell} /></svg>
            {unreadCount > 0 && role !== 'patient' && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-primary-600 text-white text-[9px] font-bold flex items-center justify-center px-1">{unreadCount}</span>}
          </button>
          <button onClick={() => navigate(roleBase + '/settings')} aria-label="Settings"
                  className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-none">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.gear} /></svg>
          </button>
          <span className="text-[11px] font-semibold text-white bg-primary-600 rounded-full px-2 py-0.5 capitalize">{role}</span>
        </div>
      </header>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-40 md:hidden pb-[max(0px,env(safe-area-inset-bottom))]">
        <div className="max-w-md mx-auto flex">
          {links.map((l) => (
            <button key={l.path} onClick={() => navigate(l.path)}
                    className={'flex-1 flex flex-col items-center gap-0.5 py-2 ' + (l.path === activePath ? 'text-primary-600' : 'text-gray-500')}>
              <TabIcon name={l.icon} active={l.path === activePath} />
              <span className={'text-[11px] ' + (l.path === activePath ? 'font-semibold text-primary-600' : 'text-gray-500')}>{l.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {role !== 'patient' && (
        <button
          aria-label="Messages"
          onClick={() => navigate(roleBase + '/messages')}
          className="fixed bottom-20 right-4 w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/30 z-40 md:hidden"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS.chat} />
          </svg>
          
        </button>
      )}
    </>
  )
}
