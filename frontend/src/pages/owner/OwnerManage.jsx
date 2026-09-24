import Skel from '../../components/Skel'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listServices, listPatients, listPriceExceptions, upsertPriceException, deletePriceException, updateClinicSettings, getClinicSettings, createService, deleteService, peso } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'

// Owner Manage — Figma frames 71–74: clinic profile, hours, services & pricing
// with per-patient exceptions. Add/delete services included.

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function OwnerManage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState(null)
  const [services, setServices] = useState([])
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getClinicSettings().then(setSettings).catch((e) => setErr(e.message))
    listServices().then(setServices).catch(() => {})
  }, [])

  const reloadServices = () => listServices().then(setServices).catch(() => {})

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

  if (!settings) return <div className="px-4 py-4"><Skel lines={2} h="h-20" /></div>

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate('/owner')} aria-label="Back" className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>
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
                        className={'flex-1 rounded-lg border py-2 text-[10px] font-bold ' + (on ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500')}>
                  {d.toUpperCase()}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 items-center">
            <input type="time" value={settings.open_time} onChange={(e) => setSettings({ ...settings, open_time: e.target.value })}
                   className="flex-1 h-10 border border-primary-600 bg-primary-50 text-primary-700 rounded-lg px-2 text-sm font-semibold text-center" />
            <span className="text-gray-500 font-bold">–</span>
            <input type="time" value={settings.close_time} onChange={(e) => setSettings({ ...settings, close_time: e.target.value })}
                   className="flex-1 h-10 border border-primary-600 bg-primary-50 text-primary-700 rounded-lg px-2 text-sm font-semibold text-center" />
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Services &amp; pricing</h2>
          <button onClick={() => setAdding((v) => !v)} className="text-xs font-semibold text-primary-700">
            {adding ? 'Close' : '+ Add Service'}
          </button>
        </div>

        {adding && <AddServiceForm onDone={() => { setAdding(false); reloadServices() }} />}

        <div className="space-y-2">
          {services.map((s) => <ServiceCard key={s.id} service={s} navigate={navigate} onDeleted={reloadServices} />)}
          {!services.length && <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-sm text-gray-500">No services yet — add one above.</div>}
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

function AddServiceForm({ onDone }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [mins, setMins] = useState('30')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!name.trim() || !(Number(price) > 0)) return setErr('Name and a price above zero are required.')
    setBusy(true)
    try {
      await createService(name.trim(), Number(price), Number(mins) || 30)
      onDone()
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
    <div className="bg-primary-50 border border-primary-100 rounded-lg p-3.5 space-y-2.5 mb-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Service name"
             className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <div className="flex gap-2">
        <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price ₱"
               className="flex-1 h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
        <input type="number" min="5" step="5" value={mins} onChange={(e) => setMins(e.target.value)} placeholder="Minutes"
               className="w-24 h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button type="button" disabled={busy} onClick={submit} className="w-full h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold">Add Service</button>
    </div>
  )
}

function ServiceCard({ service, navigate, onDeleted }) {
  const [excCount, setExcCount] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    listPriceExceptions(service.id).then((x) => setExcCount(x.length)).catch(() => setExcCount(0))
  }, [service.id])

  const remove = async () => {
    await deleteService(service.id)
    onDeleted()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 flex items-center gap-3">
      <button onClick={() => navigate(`/owner/manage/prices?service=${service.id}&name=${encodeURIComponent(service.name)}&base=${service.price}`)}
              className="flex-1 min-w-0 flex items-center gap-3 text-left">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900 truncate">{service.name}</span>
          <span className="block mt-1">
            {excCount > 0
              ? <span className="text-[11px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{excCount} exception{excCount !== 1 ? 's' : ''}</span>
              : <span className="text-xs text-gray-500">+ Custom price</span>}
          </span>
        </span>
        <span className="text-sm font-bold text-gray-900">{peso(service.price)}</span>
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {confirmDel ? (
        <span className="flex gap-1 flex-none">
          <button onClick={remove} className="text-[11px] font-bold text-red-500 border border-red-200 rounded px-1.5 py-1">Yes</button>
          <button onClick={() => setConfirmDel(false)} className="text-[11px] text-gray-500 border border-gray-200 rounded px-1.5 py-1">No</button>
        </span>
      ) : (
        <button onClick={() => setConfirmDel(true)} aria-label="Delete service" className="text-gray-300 hover:text-red-400 flex-none">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </button>
      )}
    </div>
  )
}
