import Book from './Book'
import MyAppointments from './MyAppointments'
import ConfirmBooking, { BookSuccess } from './ConfirmBooking'
import EditProfile from './EditProfile'
import Payment from './Payment'
import QrPayment from './QrPayment'
import Receipt from './Receipt'

// P1: patient pages in one lazy chunk (role-shell split).
const M = { Book, MyAppointments, ConfirmBooking, BookSuccess, EditProfile, Payment, QrPayment, Receipt }
export default function PatientShell({ name, ...props }) {
  const C = M[name]
  return C ? <C {...props} /> : null
}
