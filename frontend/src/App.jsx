import { Suspense, lazy, useEffect, useState } from 'react'
import { RoleProvider, useAuth, ROLES } from './context/RoleContext'
import Navbar from './navigation/Navbar'
import Home from './pages/Home'
import Login from './pages/Login'
import Chat from './pages/shared/Chat'
import Profile from './pages/shared/Profile'
import DoctorCalendar from './pages/doctor/DoctorCalendar'
import PatientEHR from './pages/shared/PatientEHR'
import Notifications from './pages/shared/Notifications'
import AccountSecurity from './pages/shared/AccountSecurity'
import Settings from './pages/shared/Settings'
import DevPanel from './components/DevPanel'
import Skel from './components/Skel'
import DentistRecord from './pages/shared/DentistRecord'
import ResetPassword, { ResetConfirm } from './pages/shared/ResetPassword'
import Placeholder from './pages/Placeholder'
import DoctorPatients from './pages/doctor/DoctorPatients'
import OwnerPatients from './pages/owner/OwnerPatients'
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom'

const PatientShell = lazy(() => import('./pages/patient/shells'))
const DoctorShell = lazy(() => import('./pages/doctor/shells'))
const OwnerShell = lazy(() => import('./pages/owner/shells'))

const HOME = { [ROLES.PATIENT]: '/', [ROLES.DOCTOR]: '/doctor', [ROLES.OWNER]: '/owner' }

function InstallPill() {
  const [evt, setEvt] = useState(null)
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setEvt(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (!evt) return null
  return (
    <button onClick={async () => { evt.prompt(); await evt.userChoice; setEvt(null) }}
            className="fixed right-3 z-[60] flex items-center gap-1.5 bg-primary-600 text-white text-xs font-bold px-3 h-9 rounded-full shadow-lg bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4">
      Install app
    </button>
  )
}

function Routes() {
  const { profile } = useAuth()
  const path = useLocation().pathname
  const role = profile.role
  const roleBase = role === ROLES.PATIENT ? '' : '/' + role

  const inScope = role === ROLES.PATIENT
    ? !path.startsWith('/doctor') && !path.startsWith('/owner') || path.startsWith('/reset')
    : path === '/' || path.startsWith(roleBase) || path.startsWith('/reset')

  if (!inScope) return <Navigate to={HOME[role]} replace />

  switch (path) {
    case '/': return <Home />
    case '/book': return <PatientShell name="Book" />
    case '/book/confirm': return <PatientShell name="ConfirmBooking" />
    case '/book/success': return <PatientShell name="BookSuccess" />
    case '/appointments': return <PatientShell name="MyAppointments" />
    case '/messages': return <Chat />
    case '/profile': return <Profile />
    case '/profile/edit': return <PatientShell name="EditProfile" />
    case '/security': return <AccountSecurity />
    case '/settings': return <Settings />
    case '/notifications': return <Notifications roleBase="" />
    case '/doctor': return <Home />
    case '/doctor/calendar': return <DoctorCalendar />
    case '/doctor/patients': return <DoctorPatients />
    case '/doctor/patients/ehr': return <PatientEHR />
    case '/doctor/messages': return <DoctorShell name="StaffMessages" />
    case '/doctor/notifications': return <Notifications roleBase="/doctor" />
    case '/doctor/security': return <AccountSecurity />
    case '/doctor/settings': return <Settings />
    case '/owner': return <Home />
    case '/owner/calendar': return <DoctorCalendar />
    case '/owner/patients': return <OwnerPatients />
    case '/owner/patients/ehr': return <PatientEHR />
    case '/owner/messages': return <DoctorShell name="StaffMessages" />
    case '/owner/notifications': return <Notifications roleBase="/owner" />
    case '/owner/security': return <AccountSecurity />
    case '/owner/settings': return <Settings />
    case '/owner/manage': return <OwnerShell name="OwnerManage" />
    case '/owner/manage/prices': return <OwnerShell name="OwnerServicePrices" />
    case '/owner/income': return <OwnerShell name="IncomeHub" />
    case '/owner/income/legacy': return <OwnerShell name="OwnerIncome" />
    case '/owner/staff': return <OwnerShell name="OwnerStaff" />
    case '/owner/staff/dentist': return <DentistRecord />
    case '/pay': return <PatientShell name="Payment" />
    case '/pay/qr': return <PatientShell name="QrPayment" />
    case '/receipt': return <PatientShell name="Receipt" />
    case '/reset': return <ResetPassword />
    case '/reset-confirm': return <ResetConfirm />
    default: return <Placeholder path={path} />
  }
}

function Shell() {
  const { session, profile, loading, pendingCount, deactivated, logout } = useAuth()
  if (import.meta.env.DEV) window.__auth = { session: !!session, profile, loading }

  if (loading) return <><DevPanel /><div className="max-w-md mx-auto min-h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div></>
  if (!session || !profile) return <><DevPanel /><Login /></>
  if (deactivated) return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-bold text-gray-900">Account deactivated</h1>
      <p className="text-sm text-gray-500">Your clinic access has been turned off. Contact the clinic owner.</p>
      <button onClick={logout} className="h-11 px-6 rounded-lg bg-primary-600 text-white text-sm font-semibold">Sign Out</button>
    </div>
  )

  return (
    <>
      <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-sm md:max-w-none md:pl-[72px] lg:pl-60">
        <Navbar pendingCount={pendingCount} />
        <DevPanel />
        <InstallPill />
        <main className="pb-28 md:pb-10 md:max-w-3xl xl:max-w-5xl md:mx-auto md:w-full md:px-6">
          <Suspense fallback={<div className="px-4 py-10"><Skel lines={3} h="h-14" /></div>}>
            <Routes />
          </Suspense>
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
