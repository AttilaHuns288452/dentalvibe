import { NAV_BY_ROLE } from '../navigation/navConfig'
import { useRole } from '../context/RoleContext'

export default function Placeholder({ path }) {
  const { role } = useRole()
  const item = NAV_BY_ROLE[role].find((l) => l.path === path)
  // not a nav item (e.g. chat-bubble /messages) — title-case the last segment
  const label = item?.label ?? (path.split('/').filter(Boolean).pop() || 'Page').replace(/^\w/, (c) => c.toUpperCase())
  return (
    <div className="px-4 py-16 text-center">
      <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
        </svg>
      </div>
      <h1 className="text-lg font-bold text-gray-900 mt-3">{label}</h1>
      <p className="text-xs text-gray-500 mt-1 capitalize">{role} · coming soon</p>
      <code className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded mt-2 inline-block">{path}</code>
    </div>
  )
}
