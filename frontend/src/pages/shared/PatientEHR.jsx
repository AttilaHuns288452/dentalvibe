import { useSubmit , useRevalidateOnVisible } from '../../lib/hooks'
import { useEffect, useState } from 'react'
import Skel from '../../components/Skel'
import useEscape from '../../lib/useEscape'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, peso } from '../../lib/api'
import { printReport } from '../../lib/format'
import { useAuth } from '../../context/RoleContext'

// Patient Record / EHR (Figma p64/98/124): identity card, contact & emergency,
// medical note (edit modal), treatment history (from completed appointments),
// attachments (ehr_attachments), Export EHR (PDF) — clinic-side only.

const age = (dob) => {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob)) / 31557600000)
}
const fmt = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

export default function PatientEHR() {
  const loc = useLocation()
  // deep link first (/ehr/<uuid> survives refresh & new tabs), nav state as fallback
  const id = loc.pathname.startsWith('/ehr/') ? decodeURIComponent(loc.pathname.slice(5)) : loc.state?.patientId
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [p, setP] = useState(null)
  const [appts, setAppts] = useState([])
  const [atts, setAtts] = useState([])
  const [noteEdit, setNoteEdit] = useState(null) // {text}
  const [editInfo, setEditInfo] = useState(null) // patient form copy
  const [addOpen, setAddOpen] = useState(false)
  const [err, setErr] = useState('')

  const [missing, setMissing] = useState(false)

  const load = async () => {
    if (!id) return setMissing(true)
    const { data: pat, error } = await supabase.from('staff_patients').select('*').eq('id', id).single()
    if (error) return /PGRST116|0 rows/.test(error.message + error.code) ? setMissing(true) : setErr(error.message)
    setP(pat)
    const { data: a } = await supabase.from('appointments')
      .select('id, status, price, scheduled_at, requested_date, clinical_note, services(name), dentists(full_name)')
      .eq('patient_id', id).in('status', ['completed', 'approved']).order('scheduled_at', { ascending: false })
    setAppts(a ?? [])
    const { data: at } = await supabase.from('ehr_attachments').select('*').eq('patient_id', id).order('created_at', { ascending: false })
    // newest row per category = the current record; older ones stay as history
    const seen = new Set()
    setAtts((at ?? []).map((x) => {
      const key = x.category_id ?? x.category
      const latest = !seen.has(key)
      seen.add(key)
      return { ...x, latest }
    }))
  }
  useEffect(() => { load() }, [id])
  useRevalidateOnVisible(load) // returning to the tab refreshes patient, attachments, history
  // entries reached via nav state get a shareable /ehr/<id> URL (refresh & new-tab safe)
  useEffect(() => { if (id && !loc.pathname.startsWith('/ehr/')) navigate(`/ehr/${id}`, { replace: true }) }, [id])

  const delAttImpl = async (x) => {
    if (!confirm('Delete this attachment?')) return
    if (x.path) await supabase.storage.from('ehr-files').remove([x.path])
    await supabase.from('ehr_attachments').delete().eq('id', x.id)
    setAtts((a) => a.filter((y) => y.id !== x.id))
  }
  const [delAtt, delBusy] = useSubmit(delAttImpl)

  const saveNoteImpl = async () => {
    const { error } = await supabase.from('patients').update({ medical_note: noteEdit }).eq('id', p.id)
    if (error) return setErr(error.message)
    setP((v) => ({ ...v, medical_note: noteEdit }))
    setNoteEdit(null)
  }
  const [saveNote, noteBusy] = useSubmit(saveNoteImpl)

  if (err) return <div className="px-4 py-10 text-center text-sm text-red-500">{err}</div>
  useEscape(() => setEditInfo(null), !!editInfo)
  if (missing) return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm text-gray-500">This patient record no longer exists.</p>
      <button onClick={() => navigate(-1)} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Back to patients</button>
    </div>
  )
  if (!p) return <div className="px-4 py-4"><Skel lines={2} h="h-20" /></div>

  const a = age(p.birthdate)
  const initials = (p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')

  const saveInfo = async () => {
    const { error } = await supabase.from('patients').update({
      full_name: editInfo.full_name, birthdate: editInfo.birthdate || null, sex: editInfo.sex || null,
      phone: editInfo.phone || null, email: editInfo.email || null,
      emergency_contact: editInfo.emergency_contact || null, medical_note: editInfo.medical_note || null,
    }).eq('id', p.id)
    if (error) return setErr(error.message)
    setP(editInfo)
    setEditInfo(null)
  }

  
  const viewAtt = async (x) => {
    if (!x.path) return
    const { data } = await supabase.storage.from('ehr-files').createSignedUrl(x.path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  
  const exportEHR = async () => {
    printReport(`EHR — ${p.full_name} (${p.patient_code ?? '—'})`, await exportLines())
  }

  const exportLines = async () => {
    const lines = [
      (await clinicName()) + ' — Patient Record (EHR)',
      `Generated: ${new Date().toLocaleString()}`, '',
      `Name: ${p.full_name}`, `Patient ID: ${p.patient_code ?? '—'}`,
      `Sex: ${p.sex ?? '—'}${a != null ? ` · ${a} y/o` : ''}`,
      `Mobile: ${p.phone ?? '—'}`, `Address: ${p.address ?? '—'}`,
      `Emergency contact: ${p.emergency_contact ?? '—'}`,
      `Medical note: ${p.medical_note || 'None'}`, '',
      'TREATMENT HISTORY',
      ...appts.map((x) => `  ${x.services?.name ?? 'Service'} — ${fmt(x.scheduled_at ?? x.requested_date)} · ${peso(x.price ?? 0)} paid${x.clinical_note ? `\n    Note: ${x.clinical_note}` : ''}`),
      '', 'ATTACHMENTS',
      ...atts.map((x) => `  ${x.filename} — ${x.category} · ${fmt(x.created_at)} · ${x.file_size ?? '—'}`),
    ]
    return lines
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600" aria-label="Back">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>

      <div>
        <h1 className="text-xl font-bold text-gray-900">Patient Record</h1>
        <p className="text-xs text-gray-500"><span className="font-semibold text-primary-700">EHR</span> · {p.full_name}</p>
      </div>

      {/* identity card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <span className="w-11 h-11 rounded-full bg-primary-50 text-primary-700 text-sm font-bold flex items-center justify-center flex-none">{initials}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-gray-900 truncate">{p.full_name}</span>
          <span className="block text-xs text-gray-500">
            {[p.patient_code, p.sex, a != null ? `${a} y/o` : null].filter(Boolean).join(' · ')}
            {p.address ? ` · ${p.address.split(',')[0]}` : ''}
          </span>
        </span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1 flex-none">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Confirmed
        </span>
        <button onClick={() => setEditInfo({ ...p })} aria-label="Edit patient info"
                className="w-8 h-11 rounded-lg border border-gray-200 bg-white text-gray-500 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
        </button>
      </div>

      {/* contact & emergency */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Contact &amp; emergency</h2>
        <div className="bg-white border border-gray-200 rounded-lg px-3.5 divide-y divide-gray-100">
          <div className="flex justify-between py-2.5 text-sm"><span className="text-gray-500">Mobile</span><span className="font-semibold text-gray-900">{p.phone || '—'}</span></div>
          <div className="flex justify-between py-2.5 text-sm gap-4"><span className="text-gray-500 flex-none">Emergency</span><span className="font-semibold text-gray-900 text-right">{p.emergency_contact || '—'}</span></div>
        </div>
      </section>

      {/* medical note + edit modal */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Medical note</h2>
          <button onClick={() => setNoteEdit(p.medical_note ?? '')} className="text-xs font-semibold text-primary-700 lowercase">edit</button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-sm text-gray-800">
          {p.medical_note || <span className="text-gray-500">No medical note yet.</span>}
        </div>
      </section>

      {/* treatment history */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Treatment history</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {appts.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No treatments recorded yet.</div>}
          {appts.map((x) => (
            <div key={x.id} className="px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900 min-w-0 truncate">{x.services?.name ?? 'Service'}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-none">• Completed</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {fmt(x.scheduled_at ?? x.requested_date)} · {peso(x.price ?? 0)} paid
                {x.dentists?.full_name ? ` · ${x.dentists.full_name}` : ''}
              </div>
              {x.clinical_note && <p className="text-xs text-gray-600 mt-1.5 bg-gray-50 rounded-lg px-2.5 py-2">{x.clinical_note}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* attachments */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Attachments</h2>
          <button onClick={() => setAddOpen(true)} className="text-xs font-semibold text-primary-700">+ Add</button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {atts.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No attachments yet.</div>}
          {atts.map((x) => (
            <div key={x.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-8 h-11 rounded-lg bg-gray-100 flex items-center justify-center flex-none">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-gray-900 truncate">{x.filename}</span>
                <span className="block text-xs text-gray-500">
                  {x.category} · {fmt(x.created_at)} · {x.file_size ?? '—'}
                  {x.latest && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] font-bold">LATEST</span>}
                </span>
                {x.note && <span className="block text-[11px] text-gray-400 truncate">{x.note}</span>}
              </span>
              <span className="flex gap-2 flex-none">
                <button onClick={() => viewAtt(x)} className="h-11 px-2.5 rounded-md border border-gray-200 bg-white text-[11px] font-semibold text-primary-700">View</button>
                <button disabled={delBusy} onClick={() => delAtt(x)} className="h-11 px-2.5 rounded-md border border-red-100 bg-white text-[11px] font-semibold text-red-500">Delete</button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <button onClick={exportEHR} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold mb-20 mr-16">
        Export EHR (PDF)
      </button>

      {/* edit patient info modal (p82/85) */}
      {editInfo && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={() => setEditInfo(null)}>
          <form onSubmit={(e) => { e.preventDefault(); saveInfo() }} onClick={(e) => e.stopPropagation()}
                className="bg-gray-50 w-full max-w-md rounded-t-2xl max-h-[92vh] overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Patient Info</h2>
                <p className="text-xs text-gray-500">{p.full_name} · {p.patient_code ?? '—'}</p>
              </div>
              <button type="button" onClick={() => setEditInfo(null)} aria-label="Close" className="w-8 h-11 rounded-lg bg-white border border-gray-200 text-gray-500">×</button>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <label className="block"><span className="text-xs font-medium text-gray-500">Full name</span>
                <input value={editInfo.full_name} onChange={(e) => setEditInfo((v) => ({ ...v, full_name: e.target.value }))} required
                       className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-medium text-gray-500">Birthdate</span>
                  <input type="date" value={editInfo.birthdate ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, birthdate: e.target.value }))}
                         className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
                <label className="block"><span className="text-xs font-medium text-gray-500">Sex</span>
                  <select value={editInfo.sex ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, sex: e.target.value }))}
                          className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white">
                    <option value="">—</option><option>Female</option><option>Male</option>
                  </select></label>
              </div>
              <label className="block"><span className="text-xs font-medium text-gray-500">Mobile number</span>
                <input value={editInfo.phone ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, phone: e.target.value }))}
                       className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-gray-500">Email address</span>
                <input type="email" value={editInfo.email ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, email: e.target.value }))}
                       className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-gray-500">Emergency contact</span>
                <input value={editInfo.emergency_contact ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, emergency_contact: e.target.value }))}
                       className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-gray-500">Internal notes — visible to clinic staff only</span>
                <textarea value={editInfo.medical_note ?? ''} onChange={(e) => setEditInfo((v) => ({ ...v, medical_note: e.target.value }))} rows={3}
                          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label>
            </div>
            <div className="flex gap-2.5 pb-4">
              <button type="button" onClick={() => setEditInfo(null)} className="flex-1 h-11 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold">Cancel</button>
              <button className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* edit medical note modal (p124) */}
      {noteEdit !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setNoteEdit(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
              <h3 className="text-sm font-bold text-gray-900">Edit medical note</h3>
            </div>
            <textarea value={noteEdit} onChange={(e) => setNoteEdit(e.target.value)} rows={5} placeholder="Allergies…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2.5">
              <button onClick={() => setNoteEdit(null)} className="flex-1 h-10 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold">Cancel</button>
              <button disabled={noteBusy} onClick={saveNote} className="flex-1 h-10 rounded-lg bg-primary-600 text-white text-sm font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {addOpen && <AddAttachment patient={p} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load() }} />}
    </div>
  )
}

// Add Attachment (Figma p110)
function AddAttachment({ patient, onClose, onSaved }) {
  const [cats, setCats] = useState([]) // active record_categories — configurable
  const [cat, setCat] = useState(null) // selected category row
  useEffect(() => {
    supabase.from('record_categories').select('id, name').eq('active', true).eq('archived', false).order('sort_order')
      .then(({ data }) => { setCats(data ?? []); setCat((c) => c ?? data?.[0] ?? null) })
  }, [])
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { profile } = useAuth()

  const pick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) return setErr('Max file size is 10 MB.')
    if (!/\.(png|jpe?g|pdf|webp)$/i.test(f.name)) return setErr('Supported: JPG, PNG, WEBP, PDF.')
    setErr('')
    setFile(f)
  }

  const uploadImpl = async () => {
    if (!cat) return setErr('Pick a category.')
    if (!file) return setErr('Choose a file first.')
    setBusy(true)
    setErr('')
    try {
      // real file → private bucket (staff-only RLS on storage.objects)
      const path = `${patient.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('ehr-files').upload(path, file, { upsert: false })
      if (upErr) throw upErr
      const { error } = await supabase.from('ehr_attachments').insert({
        patient_id: patient.id, category: cat.name, category_id: cat.id, filename: file.name, path,
        file_size: (file.size / 1048576).toFixed(1) + ' MB', note: note || null, uploaded_by: profile?.id ?? null,
      })
      if (error) {
        await supabase.storage.from('ehr-files').remove([path]) // rollback: no orphaned clinical files
        throw error
      }
      onSaved()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }
  const [upload, upBusy] = useSubmit(uploadImpl)

  useEscape(onClose)
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); upload() }} onClick={(e) => e.stopPropagation()}
            className="bg-gray-50 w-full max-w-md rounded-t-2xl max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add Attachment</h2>
            <p className="text-xs text-gray-500">{patient.full_name} · EHR</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-11 rounded-lg bg-white border border-gray-200 text-gray-500">×</button>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">File category</div>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button key={c.id} type="button" onClick={() => setCat(c)}
                      className={'h-11 px-3 rounded-full text-xs font-semibold border ' + (cat?.id === c.id ? 'bg-primary-50 text-primary-700 border-primary-300' : 'bg-white text-gray-600 border-gray-200')}>{c.name}</button>
            ))}
            {!cats.length && <span className="text-xs text-gray-500">No active categories — owner can add them in Manage.</span>}
          </div>
        </div>

        <label className="block border-2 border-dashed border-gray-200 rounded-lg bg-white py-6 text-center cursor-pointer">
          <div className="text-sm font-semibold text-gray-800">{file ? file.name : 'Tap to choose file'}</div>
          <div className="text-[11px] text-gray-500">PNG · JPG · PDF · max 10 MB</div>
          <input type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={pick} className="hidden" />
        </label>

        <label className="block"><span className="text-xs font-medium text-gray-500">Optional note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Periapical view before extraction"
                 className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>

        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold">Cancel</button>
          <button disabled={busy} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? 'Uploading…' : 'Upload Attachment'}</button>
        </div>
        <div className="bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800 flex gap-2 pb-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 flex-none mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3 8-8 10-5-2-8-5.5-8-10V6z" /></svg>
          Attachments are visible to clinic staff only — patients cannot see them on the portal.
        </div>
      </form>
    </div>
  )
}
