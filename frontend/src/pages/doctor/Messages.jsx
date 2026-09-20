import { useLocation } from 'react-router-dom'
import Chat from '../shared/Chat'

// /messages for staff: patient comes from navigation state (picked in Patients list).

export default function Messages() {
  const { state } = useLocation()
  return <Chat patient={state?.patient} />
}
