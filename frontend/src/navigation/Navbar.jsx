import { NAV_BY_ROLE, ICONS } from './navConfig'
import { useRole } from '../context/RoleContext'
import { navigate } from './useHashPath'

function TabIcon({ name, active }) {
  return (
    <svg viewBox="0 0 24 24" className={'w-6 h-6 ' + (active ? 'text-primary-600' : 'text-gray-400')} fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

export default function Navbar({ path }) {
  const { role, user } = useRole()
  const links = NAV_BY_ROLE[role]
  // the longest matching section wins, so /owner/manage highlights Manage not Home
  const matches = links.filter((l) => path === l.path || (l.path !== '/' && path.startsWith(l.path + '/')))
  const activePath = matches.sort((a, b) => b.path.length - a.path.length)[0]?.path
  const isActive = (l) => l.path === activePath
  const roleBase = role === 'patient' ? '' : '/' + role

  return (
    <>
      {/* top app bar — brand + role/user, per the Figma headers */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          <a href="#/" className="w-9 h-9 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-none">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
            </svg>
          </a>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 leading-tight">D.A.R. Dental Clinic</div>
            <div className="text-[11px] text-gray-500 leading-tight capitalize">
              {role === 'patient' ? 'Patient Portal' : role === 'doctor' ? 'Dentist Portal' : 'Clinic Owner'}
              {' · '}{user.name}
            </div>
          </div>
          <span className="text-[11px] font-semibold text-white bg-primary-600 rounded-full px-2 py-0.5 capitalize">{role}</span>
        </div>
      </header>

      {/* bottom tab bar — the Figma navbar */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-40">
        <div className="max-w-md mx-auto flex">
          {links.map((l) => (
            <a key={l.path} href={'#' + l.path}
               className={'flex-1 flex flex-col items-center gap-0.5 py-2 ' + (isActive(l) ? 'text-primary-600' : 'text-gray-400')}>
              <TabIcon name={l.icon} active={isActive(l)} />
              <span className={'text-[11px] ' + (isActive(l) ? 'font-semibold text-primary-600' : 'text-gray-400')}>{l.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* floating chat bubble with unread badge — dentist + owner screens (per Figma) */}
      {role !== 'patient' && (
        <button
          aria-label="Messages"
          onClick={() => navigate(roleBase + '/messages')}
          className="fixed bottom-20 right-4 w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/30 z-40"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS.chat} />
          </svg>
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">3</span>
        </button>
      )}
    </>
  )
}
