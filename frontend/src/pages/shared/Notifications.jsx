import { useEffect, useState } from 'react'
import Skel from '../../components/Skel'
import { supabase } from '../../lib/api'
import { useAuth } from '../../context/RoleContext'
import { useRevalidateOnVisible } from '../../lib/hooks'

const ICON_PATHS = {
  check: 'M5 13l4 4L19 7',
  card: 'M3 6h18v12H3zM3 10h18',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 8v4l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a1.9 1.9 0 0 0 3.4 0',
}
const ICON_BG = {
  check: 'bg-green-100 text-green-600',
  card: 'bg-blue-100 text-blue-600',
  x: 'bg-red-100 text-red-500',
  clock: 'bg-primary-100 text-primary-600',
  mail: 'bg-sky-100 text-sky-600',
  bell: 'bg-amber-100 text-amber-600',
}
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export default function Notifications({ roleBase = '' }) {
  const { refresh } = useAuth() // bell badge lives in context — invalidate it here (#45)
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')

  const load = async () => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) return setErr(error.message)
        setItems(data ?? [])
      })
  }
  useEffect(() => { load() }, [])
  useRevalidateOnVisible(load)

  const markRead = (id) => {
    setItems((a) => a.map((x) => (x.id === id ? { ...x, read: true } : x)))
    supabase.from('notifications').update({ read: true }).eq('id', id).then(() => refresh())
  }
  const markAll = () => {
    setItems((a) => a.map((x) => ({ ...x, read: true })))
    supabase.from('notifications').update({ read: true }).eq('read', false).then(() => refresh())
  }

  const loadingRows = items === null
  const today = (items ?? []).filter((n) => new Date(n.created_at).toDateString() === new Date().toDateString())
  const earlier = (items ?? []).filter((n) => new Date(n.created_at).toDateString() !== new Date().toDateString())
  const unread = (items ?? []).filter((n) => !n.read).length

  const Row = ({ n }) => (
    <button type="button" onClick={() => markRead(n.id)}
            className="w-full text-left flex gap-3 px-3.5 py-3 border-b border-gray-100 last:border-0">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${ICON_BG[n.icon] ?? ICON_BG.bell}`}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[n.icon] ?? ICON_PATHS.bell} /></svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            {n.title}
            {!n.read && <span className="w-2 h-2 rounded-full bg-primary-600 flex-none" aria-label="unread" />}
          </div>
          <span className="text-[10px] text-gray-500 flex-none">{ago(n.created_at)}</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>
      </div>
    </button>
  )

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="text-xs text-gray-500 capitalize">{roleBase ? roleBase.slice(1) : 'Patient'} Portal</p>
        </div>
        {unread > 0 && (
          <button onClick={markAll} className="text-xs font-semibold text-primary-700">Mark all read</button>
        )}
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}

      {loadingRows && <Skel lines={4} h="h-14" />}
      {items?.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg py-10 text-center text-sm text-gray-500">No notifications yet.</div>
      )}

      {today.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Today</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {today.map((n) => <Row key={n.id} n={n} />)}
          </div>
        </section>
      )}
      {earlier.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Earlier</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {earlier.map((n) => <Row key={n.id} n={n} />)}
          </div>
        </section>
      )}

      <div className="bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800 flex gap-2">
        <svg viewBox="0 0 24 24" className="w-4 h-4 flex-none mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS.bell} /></svg>
        You get an in-app notification for every booking event the moment it happens.
      </div>
    </div>
  )
}
