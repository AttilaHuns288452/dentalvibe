import StaffMessages from './Messages'

// P1: doctor pages in one lazy chunk (role-shell split).
const M = { StaffMessages }
export default function DoctorShell({ name, ...props }) {
  const C = M[name]
  return C ? <C {...props} /> : null
}
