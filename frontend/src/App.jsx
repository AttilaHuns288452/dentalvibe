import { useEffect } from 'react'
import { RoleProvider, useRole } from './context/RoleContext'
import Navbar from './navigation/Navbar'
import { useHashPath } from './navigation/useHashPath'
import RoleSwitcher from './navigation/RoleSwitcher'
import { NAV_BY_ROLE } from './navigation/navConfig'
import Placeholder from './pages/Placeholder'

function Router() {
  const path = useHashPath()
  const { role } = useRole()

  // keep the current route inside the active role's nav — on role switch,
  // snap to that role's home instead of stranding the user on a dead route.
  // the role's own /messages is reachable from the chat bubble, not a tab.
  useEffect(() => {
    const links = NAV_BY_ROLE[role]
    const messagesPath = role === 'patient' ? '/messages' : `/${role}/messages`
    if (!links.some((l) => l.path === path) && path !== messagesPath) {
      window.location.hash = links[0].path
    }
  }, [role, path])

  // every route is a placeholder for now — screens get built into pages/ one by one
  return <Placeholder path={path} />
}

export default function App() {
  const path = useHashPath()
  return (
    <RoleProvider>
      <div className="min-h-screen bg-gray-50">
        <RoleSwitcher />
        <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-sm">
          <Navbar path={path} />
          {/* room for the fixed bottom tab bar */}
          <main className="pb-20">
            <Router />
          </main>
        </div>
      </div>
    </RoleProvider>
  )
}
