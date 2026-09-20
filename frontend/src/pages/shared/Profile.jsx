import { useAuth } from '../../context/RoleContext'
import { signOut } from '../../lib/api'

export default function Profile() {
  const { session, profile, patientRecord } = useAuth()

  const rows = profile?.role === 'patient'
    ? [['Full name', profile.full_name], ['Email', session.user.email], ['Patient ID', patientRecord ? `PAT-${String(patientRecord.id).slice(0, 8).toUpperCase()}` : '—'], ['Role', 'Patient']]
    : [['Full name', profile.full_name], ['Email', session.user.email], ['Role', profile.role === 'owner' ? 'Doctor Owner' : 'Dentist']]

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        <p className="text-xs text-gray-500">Account information</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-primary-50 text-primary-700 font-bold flex items-center justify-center text-lg flex-none">
          {(profile.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900">{profile.full_name}</div>
          <div className="text-xs text-gray-500">{session.user.email}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-3.5 py-2.5 text-sm">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium text-gray-900">{v}</span>
          </div>
        ))}
      </div>

      <button
        onClick={async () => { await signOut(); window.location.reload() }}
        className="w-full h-11 rounded-lg border border-red-200 text-red-500 text-sm font-semibold bg-white">
        Log Out
      </button>
    </div>
  )
}
