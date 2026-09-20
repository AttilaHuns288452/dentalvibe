import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listChat, sendChat, subscribeChat } from '../../lib/api'

// Chat thread. Patient sees their own thread; staff picks a patient first.
// Figma frames 07 (patient) — bubbles + input row + send.

export default function Chat({ patient }) {
  const { patientRecord, profile } = useAuth()
  const thread = patient ?? patientRecord // staff passes a patient; patient uses own record
  const me = profile?.role === 'patient' ? 'patient' : 'clinic'
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!thread?.id) return
    let unsub
    listChat(thread.id).then(setMessages).catch(() => setMessages([]))
    unsub = subscribeChat(thread.id, (m) => setMessages((prev) => [...(prev ?? []), m]))
    return unsub
  }, [thread?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages?.length])

  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    await sendChat(thread.id, me, body)
  }

  if (!thread?.id) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">Messages</h1>
        <p className="text-xs text-gray-500 mt-1">Open a conversation from the Patients tab — tap any patient to chat.</p>
        <button onClick={() => window.history.back()} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Go to Patients</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9.5rem)]">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <h1 className="text-base font-bold text-gray-900">{thread.full_name || 'DentalVibe'}</h1>
        <p className="text-[11px] text-primary-600">online</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50">
        {messages?.length === 0 && <p className="text-center text-xs text-gray-400 py-8">No messages yet — say hi!</p>}
        {(messages ?? []).map((m) => {
          const mine = m.sender === me
          return (
            <div key={m.id} className={'max-w-[78%] px-3 py-2 rounded-lg text-sm ' + (mine ? 'ml-auto bg-primary-50 text-gray-800' : 'bg-white border border-gray-200 text-gray-800')}>
              {m.body}
              <div className={'text-[10px] text-gray-400 mt-1 ' + (mine ? 'text-right' : '')}>
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
        <button className="w-11 h-11 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-none" aria-label="Send">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
        </button>
      </form>
    </div>
  )
}
