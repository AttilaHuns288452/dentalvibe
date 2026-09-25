import { useEffect, useRef, useState } from 'react'
import Skel from '../../components/Skel'
import { useAuth } from '../../context/RoleContext'
import { listChat, sendChat, subscribeChat, listPatients } from '../../lib/api'

// Chat thread. Patient sees their own thread; staff picks a patient first.
// Figma frames 07 (patient) — bubbles + input row + send.

function StaffPatientPicker({ onPick }) {
  const [patients, setPatients] = useState(null)
  const [q, setQ] = useState('')
  const [loadErr, setLoadErr] = useState('')
  useEffect(() => { listPatients().then(setPatients).catch((e) => { setPatients([]); setLoadErr(e?.message || "connection lost") }) }, [])
  const filtered = (patients ?? []).filter((p) => p.full_name?.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="px-4 py-4 space-y-3">
      <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      <p className="text-xs text-gray-500 -mt-2">Pick a conversation</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients…"
             className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtered.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
            <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
              {(p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <span className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">{p.full_name}</span>
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        ))}
        {!patients && <Skel lines={3} h="h-14" />}
        {patients && filtered.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No patients found.</div>}
      </div>
    </div>
  )
}

export default function Chat({ patient }) {
  const { patientRecord, profile } = useAuth()
  const thread = patient ?? patientRecord // staff passes a patient; patient uses own record
  const [picked, setPicked] = useState(null) // staff picks from inline picker (deep link)
  const active = picked ?? thread
  const me = profile?.role === 'patient' ? 'patient' : 'clinic'
  const [threadErr, setThreadErr] = useState('')
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState('')
  const [sendErr, setSendErr] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!active?.id) return
    let unsub
    listChat(active.id).then(setMessages).catch((e) => { setMessages([]); setThreadErr(e?.message || "connection lost") })
    unsub = subscribeChat(active.id, (m) => setMessages((prev) => (prev ?? []).some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]))
    return unsub
  }, [active?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages?.length])

  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    try {
      await sendChat(active.id, me, body)
      setMessages(await listChat(active.id)) // refetch — realtime may lag or be disabled
    } catch (ex) {
      setSendErr(ex.message)
    }
  }

  if (!active?.id) {
    return <StaffPatientPicker onPick={setPicked} />
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9.5rem)]">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <h1 className="text-base font-bold text-gray-900">{active.full_name || 'DentalVibe'}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50">
        {messages === null && <Skel lines={3} h="h-12" />}
        {messages?.length === 0 && <p className="text-center text-xs text-gray-500 py-8">No messages yet — say hi!</p>}
        {(messages ?? []).map((m) => {
          const mine = m.sender === me
          return (
            <div key={m.id} className={'max-w-[78%] px-3 py-2 rounded-lg text-sm ' + (mine ? 'ml-auto bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-800')}>
              <div className={'text-[10px] font-bold mb-0.5 ' + (mine ? 'text-right text-primary-100' : 'text-gray-400')}>
                {mine ? 'You' : m.sender === 'patient' ? 'Patient' : 'Clinic'}
              </div>
              {m.body}
              <div className={'text-[10px] mt-1 ' + (mine ? 'text-right text-primary-100' : 'text-gray-500')}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 px-4 py-2.5 bg-white border-t border-gray-200">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…"
               className="flex-1 h-11 border border-gray-200 rounded-lg px-3 text-sm bg-gray-50" />
        {sendErr && <p className="text-xs text-red-500 self-center">{sendErr}</p>}
        <button className="w-11 h-11 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-none" aria-label="Send">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
        </button>
      </form>
    </div>
  )
}
