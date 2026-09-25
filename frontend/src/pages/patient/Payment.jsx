import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Legacy receipt-upload page removed — payment is now the PayMongo dynamic QR
// screen. /pay deep links forward so old routes keep working.
export default function Payment() {
  const { state, search } = useLocation()
  const navigate = useNavigate()
  const apptId = new URLSearchParams(search).get('appt') ?? state?.appointment?.id ?? null

  useEffect(() => {
    navigate(apptId ? '/pay/qr?appt=' + apptId : '/appointments', { replace: true })
  }, [apptId, navigate])

  return null
}
