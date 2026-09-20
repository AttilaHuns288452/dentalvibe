import { BrowserRouter, Navigate, useLocation } from 'react-router-dom'
import { RoleProvider, useAuth, ROLES } from './context/RoleContext'
import Navbar from './navigation/Navbar'
import RoleSwitcher from './navigation/RoleSwitcher'
import Home from './pages/Home'
import Login from './pages/Login'
import Book from './pages/patient/Book'
import MyAppointments from './pages/patient/MyAppointments'
import Chat from './pages/shared/Chat'
import Profile from './pages/shared/Profile'
import Requests from './pages/doctor/Requests'
import DoctorCalendar from './pages/doctor/DoctorCalendar'
import DoctorPatients from './pages/doctor/DoctorPatients'
import StaffMessages from './pages/doctor/Messages'
import OwnerManage from './pages/owner/OwnerManage'
import OwnerServicePrices from './pages/owner/OwnerServicePrices'
import OwnerPatients from './pages/owner/OwnerPatients'
import OwnerIncome from './pages/owner/OwnerIncome'
import OwnerStaff from './pages/owner/OwnerStaff'
import Placeholder from './pages/Placeholder'

const HOME = { [ROLES.PATIENT]: '/', [ROLES.DOCTOR]: '/doctor', [ROLES.OWNER]: '/owner' }

function Routes() {
  const { profile } = useAuth()
  const path = useLocation().pathname
  const role = profile.role
  const roleBase = role === ROLES.PATIENT ? '' : '/' + role

  // routes outside this role's section → snap to the role's home
  const inScope = role === ROLES.PATIENT
    ? !path.startsWith('/doctor') && !path.startsWith('/owner')
    : path === '/' || path.startsWith(roleBase)

  if (!inScope) return <Navigate to={HOME[role]} replace />

  switch (path) {
    case '/': return <Home />
    case '/book': return <Book />
    case '/appointments': return <MyAppointments />
    case '/messages': return <Chat />
    case '/profile': return <Profile />
    case '/doctor': return <Home />
    case '/doctor/calendar': return <DoctorCalendar />
    case '/doctor/requests': return <Requests />
    case '/doctor/patients': return <DoctorPatients />
    case '/doctor/messages': return <StaffMessages />
    case '/owner': return <Home />
    case '/owner/calendar': return <DoctorCalendar />
    case '/owner/requests': return <Requests />
    case '/owner/patients': return <OwnerPatients />
    case '/owner/messages': return <StaffMessages />
    case '/owner/manage': return <OwnerManage />
    case '/owner/manage/prices': return <OwnerServicePrices />
    case '/owner/income': return <OwnerIncome />
    case '/owner/staff': return <OwnerStaff />
    default: return <Placeholder path={path} />
  }
}

function Shell() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>
  }
  if (!session || !profile) {
    return (
      <div className="max-w-md mx-auto min-h-screen shadow-sm"><Login /></div>
    )
  }

  return (
    <>
      <RoleSwitcher />
      <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-sm">
        <Navbar />
        <main className="pb-20">
          <Routes />
        </main>
      </div>
    </>
  )
}

export default function App() {
  return (
    <RoleProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </RoleProvider>
  )
}
