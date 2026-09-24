import { useEffect, useState } from 'react'
import { RoleProvider, useAuth, ROLES } from './context/RoleContext'
import Navbar from './navigation/Navbar'
import Home from './pages/Home'
import Login from './pages/Login'
import Book from './pages/patient/Book'
import MyAppointments from './pages/patient/MyAppointments'
import Chat from './pages/shared/Chat'
import Profile from './pages/shared/Profile'
import DoctorCalendar from './pages/doctor/DoctorCalendar'
import DoctorPatients from './pages/doctor/DoctorPatients'
import StaffMessages from './pages/doctor/Messages'
import OwnerManage from './pages/owner/OwnerManage'
import OwnerServicePrices from './pages/owner/OwnerServicePrices'
import OwnerPatients from './pages/owner/OwnerPatients'
import OwnerIncome from './pages/owner/OwnerIncome'
import IncomeHub from './pages/owner/IncomeHub'
import OwnerStaff from './pages/owner/OwnerStaff'
import Payment from './pages/patient/Payment'
import QrPayment from './pages/patient/QrPayment'
import ConfirmBooking, { BookSuccess } from './pages/patient/ConfirmBooking'
import Receipt from './pages/patient/Receipt'
import PatientEHR from './pages/shared/PatientEHR'
import EditProfile from './pages/patient/EditProfile'
import Notifications from './pages/shared/Notifications'
import AccountSecurity from './pages/shared/AccountSecurity'
import Settings from './pages/shared/Settings'
import DevPanel from './components/DevPanel'
import DentistRecord from './pages/shared/DentistRecord'
import ResetPassword, { ResetConfirm } from './pages/shared/ResetPassword'
import Placeholder from './pages/Placeholder'
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom'

const HOME = { [ROLES.PATIENT]: '/', [ROLES.DOCTOR]: '/doctor', [ROLES.OWNER]: '/owner' }

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
    case '/book': return <Book />
    case '/book/confirm': return <ConfirmBooking />
    case '/book/success': return <BookSuccess />
    case '/appointments': return <MyAppointments />
    case '/messages': return <Chat />
    case '/profile': return <Profile />
    case '/profile/edit': return <EditProfile />
    case '/security': return <AccountSecurity />
    case '/settings': return <Settings />
    case '/notifications': return <Notifications roleBase="" />
    case '/doctor': return <Home />
    case '/doctor/calendar': return <DoctorCalendar />
    case '/doctor/patients': return <DoctorPatients />
    case '/doctor/patients/ehr': return <PatientEHR />
    case '/doctor/messages': return <StaffMessages />
    case '/doctor/notifications': return <Notifications roleBase="/doctor" />
    case '/doctor/security': return <AccountSecurity />
    case '/doctor/settings': return <Settings />
    case '/owner': return <Home />
    case '/owner/calendar': return <DoctorCalendar />
    case '/owner/patients': return <OwnerPatients />
    case '/owner/patients/ehr': return <PatientEHR />
    case '/owner/messages': return <StaffMessages />
    case '/owner/notifications': return <Notifications roleBase="/owner" />
    case '/owner/security': return <AccountSecurity />
    case '/owner/settings': return <Settings />
    case '/owner/manage': return <OwnerManage />
    case '/owner/manage/prices': return <OwnerServicePrices />
    case '/owner/income': return <IncomeHub />
    case '/owner/income/legacy': return <OwnerIncome />
    case '/owner/staff': return <OwnerStaff />
    case '/owner/staff/dentist': return <DentistRecord />
    case '/pay': return <Payment />
    case '/pay/qr': return <QrPayment />
    case '/receipt': return <Receipt />
    case '/reset': return <ResetPassword />
    case '/reset-confirm': return <ResetConfirm />
    default: return <Placeholder path={path} />
  }
}

function Shell() {
  const { session, profile, loading, pendingCount, deactivated, logout } = useAuth()
  if (import.meta.env.DEV) window.__auth = { session: !!session, profile, loading }

  if (loading) return <><DevPanel /><div className="max-w-md mx-auto min-h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div></>
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
      <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-sm">
        <Navbar pendingCount={pendingCount} />
        <DevPanel />
        <main className="pb-28">
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
