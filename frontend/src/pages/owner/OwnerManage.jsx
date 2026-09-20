import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listServices, listPatients, listPriceExceptions, upsertPriceException, deletePriceException, updateClinicSettings, getClinicSettings, peso } from '../../lib/api'

// Owner Manage — Figma frames 71–74: clinic profile, hours, services & pricing
// with per-patient exceptions ("like adding members to a group chat").

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function OwnerManage() {
  const [settings, setSettings] = useState(null)
  const [services, setServices] = useState([])
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    getClinicSettings().then(setSettings).catch((e) => setErr(e.message))
    listServices().then(setServices).catch(() => {})
  }, [])

  const save = async () => {
    try {
      await updateClinicSettings({
        clinic_name: settings.clinic_name,
        dentist_name: settings.dentist_name,
        clinic_email: settings.clinic_email,
        open_days: settings.open_days,
        open_time: settings.open_time,
        close_time: settings.close_time,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e.message)
    }
  }

  if (!settings) return <p className="px-4 py-10 text-sm text-gray-400">Loading…</p>

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Manage</h1>
        <p className="text-xs text-gray-500">Clinic setup · hours &amp; pricing</p>
      </div>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Clinic profile</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          {['clinic_name:Clinic name', 'dentist_name:Dentist', 'clinic_email:Clinic email'].map((pair) => {
            const [key, label] = pair.split(':')
            return (
              <label key={key} className="block">
                <span className="text-xs font-medium text-gray-500">{label}</span>
                <input value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                       className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" />
              </label>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Clinic hours</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex gap-1.5">
            {ALL_DAYS.map((d) => {
              const on = settings.open_days.includes(d)
              return (
                <button key={d} onClick={() => setSettings({ ...settings, open_days: on ? settings.open_days.filter((x) => x !== d) : [...settings.open_days, d] })}
                        className={'flex-1 rounded-lg border py-2 text-[10px] font-bold ' + (on ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-400')}>
                  {d.toUpperCase()}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 items-center">
            <input type="time" value={settings.open_time} onChange={(e) => setSettings({ ...settings, open_time: e.target.value })}
                   className="flex-1 h-10 border border-primary-600 bg-primary-50 text-primary-700 rounded-lg px-2 text-sm font-semibold text-center" />
            <span className="text-gray-400 font-bold">–</span>
            <input type="time" value={settings.close_time} onChange={(e) => setSettings({ ...settings, close_time: e.target.value })}
                   className="flex-1 h-10 border border-primary-600 bg-primary-50 text-primary-700 rounded-lg px-2 text-sm font-semibold text-center" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Services &amp; pricing</h2>
        <div className="space-y-2">
          {services.map((s) => <ServiceCard key={s.id} service={s} navigate={navigate} />)}
          {!services.length && <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-sm text-gray-400">No services yet.</div>}
        </div>
      </section>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={save} className="w-full h-12 rounded-lg bg-primary-600 text-white font-semibold">
        {saved ? 'Saved ✓' : 'Save Changes'}
      </button>
      <div className="h-4" />
    </div>
  )
}

function ServiceCard({ service, navigate }) {
  const [excCount, setExcCount] = useState(null)

  useEffect(() => {
    listPriceExceptions(service.id).then((x) => setExcCount(x.length)).catch(() => setExcCount(0))
  }, [service.id])

  return (
    <button onClick={() => navigate(`/owner/manage/prices?service=${service.id}&name=${encodeURIComponent(service.name)}&base=${service.price}`)}
            className="w-full text-left bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 flex items-center gap-3">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-gray-900 truncate">{service.name}</span>
        <span className="block mt-1">
          {excCount > 0
            ? <span className="text-[11px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{excCount} exception{excCount !== 1 ? 's' : ''}</span>
            : <span className="text-xs text-gray-400">+ Custom price</span>}
        </span>
      </span>
      <span className="text-sm font-bold text-gray-900">{peso(service.price)}</span>
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  )
}
