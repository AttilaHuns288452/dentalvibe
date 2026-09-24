import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isDev, mockPay } from '../../lib/dev'
import { supabase } from '../../supabaseClient'
import { peso } from '../../lib/api'

// Booking payment flow (p121→123): confirm summary → QR with 15:00 countdown →
// then the existing proof-upload page. QR is a hand-rolled byte-mode QR
// renderer (version auto, EC level L) — no external dependency.
// ponytail: minimal QR spec impl; if logos/styling ever needed, swap for a lib.

// ---- QR encoder (byte mode, ECC L, versions 1-10) ----
const GF_EXP = new Array(512), GF_LOG = new Array(256)
for (let i = 0, x = 1; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d }
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
const gmul = (a, b) => (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0

function rsGenPoly(deg) {
  let poly = [1]
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gmul(poly[j], GF_EXP[i]) }
    poly = next
  }
  return poly
}

// EC codewords per version (L) + data capacity — table subset for short payloads
const EC_L = { 1: 7, 2: 10, 3: 15, 4: 20, 5: 26, 6: 18, 7: 20, 8: 24, 9: 30, 10: 18 }
const DATA_L = { 1: 19, 2: 34, 3: 55, 4: 80, 5: 108, 6: 136, 7: 156, 8: 194, 9: 232, 10: 274 }
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }

function encodeQR(text) {
  const bytes = new TextEncoder().encode(text)
  let ver = 1
  while (ver <= 10 && DATA_L[ver] < bytes.length + 2) ver++
  if (ver > 10) throw new Error('payload too long')
  const dataCount = DATA_L[ver], ecCount = EC_L[ver]

  // bit stream: mode(4) + count(8) + data + terminator + pad
  const bits = []
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1) }
  push(4, 4); push(bytes.length, 8)
  bytes.forEach((b) => push(b, 8))
  const cap = dataCount * 8
  push(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  const pads = [0xec, 0x11]
  while (bits.length < cap) push(pads[(bits.length / 8) % 2], 8)
  const dataBytes = []
  for (let i = 0; i < bits.length; i += 8) dataBytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // RS error correction
  const gen = rsGenPoly(ecCount)
  const ec = new Array(ecCount).fill(0)
  dataBytes.forEach((b) => {
    const factor = b ^ ec[0]
    ec.shift(); ec.push(0)
    if (factor) for (let i = 0; i < ecCount; i++) ec[i] ^= gmul(gen[i + 1], factor)
  })
  const all = dataBytes.concat(ec)

  // matrix
  const size = 17 + 4 * ver
  const m = Array.from({ length: size }, () => new Array(size).fill(null))
  const setFinder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
      m[rr][cc] = (i >= 0 && i <= 6 && j >= 0 && j <= 6) ? (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) : false
    }
  }
  setFinder(0, 0); setFinder(0, size - 7); setFinder(size - 7, 0)
  // timing
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0 }
  // alignment
  const centers = [6, ...ALIGN[ver]]
  for (const r of centers) for (const c of centers) {
    if (m[r][c] !== null) continue
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1
  }
  // dark module + reserve format areas
  m[size - 8][8] = true
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false }
  for (let i = size - 8; i < size; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false }

  // zigzag data placement
  let bitIdx = 0, upward = true
  const totalBits = all.length * 8
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i
      for (const c of [col, col - 1]) {
        if (m[row][c] === null) {
          m[row][c] = bitIdx < totalBits ? ((all[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1 : false
          bitIdx++
        }
      }
    }
    upward = !upward
  }

  // format info: EC level L (01) + mask 0 → 0b111011111000100
  const fmtStr = 0b111011111000100
  const place = (i, r, c) => { m[r][c] = ((fmtStr >> i) & 1) === 1 }
  for (let i = 0; i <= 5; i++) place(i, 8, i)
  place(6, 8, 7); place(7, 8, 8); place(8, 7, 8)
  for (let i = 9; i < 15; i++) place(i, 14 - i, 8)
  for (let i = 0; i < 8; i++) place(i, size - 1 - i, 8)
  for (let i = 8; i < 15; i++) place(i, 8, size - 15 + i)
  m[size - 8][8] = true

  return { size, m }
}

export function QR({ text, size = 180 }) {
  const { size: n, m } = useMemo(() => encodeQR(text), [text])
  const cells = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) cells.push(<rect key={r + '-' + c} x={c} y={r} width="1" height="1" />)
  return <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="bg-white rounded">{cells}</svg>
}

export default function QrPayment() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const appt = state?.appointment
  const [secs, setSecs] = useState(15 * 60)
  const [err, setErr] = useState('')
  const svgRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  if (!appt) return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm text-gray-500">Missing appointment.</p>
      <button onClick={() => navigate('/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
    </div>
  )

  const svc = appt.services?.name ?? 'Appointment'
  const amount = appt.price ?? 0
  // GCash-style payload: clinic payment reference
  const ref = 'DAR-' + String(appt.id).slice(0, 8).toUpperCase()
  const qrText = `DARDENTAL|REF:${ref}|AMT:${amount}|SERVICE:${svc}`
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0')

  const download = () => {
    const svg = svgRef.current?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payment-qr-${ref}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-screen bg-primary-700 px-4 py-6">
      <button onClick={() => history.back()} aria-label="Back" className="w-9 h-9 rounded-lg bg-white text-primary-700 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>

      <div className="relative bg-white rounded-2xl mt-8 px-5 py-6 text-center">
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 rounded-xl bg-white shadow flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3 8-8 10-5-2-8-5.5-8-10V6zM9 12l2 2 4-4" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-6">You're Almost Done!</h1>
        <p className="text-xs text-gray-500 mt-1">Scan the QR code with your preferred payment app to secure your appointment.</p>
        <p className="text-sm font-bold text-gray-900 mt-3">This QR is valid for <span className={secs < 60 ? 'text-red-500' : ''}>{mm}:{ss}</span></p>

        <div ref={svgRef} className="flex justify-center my-4"><QR text={qrText} /></div>

        <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-100 pt-3">
          <span>Total payment</span><span>{peso(amount)}</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">Ref: {ref} · {svc}</div>
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
          This is your <b>appointment fee</b> — it reserves the slot. Treatment charges are billed separately at the clinic.
        </p>
        {secs === 0 && (
          <p className="text-xs font-semibold text-red-500 mt-2">QR expired — generate a new one to continue.</p>
        )}

        {secs === 0 ? (
          <button onClick={() => setSecs(15 * 60)} className="w-full h-11 mt-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Generate new QR</button>
        ) : (
          <button onClick={download} className="w-full h-11 mt-4 rounded-lg bg-gray-100 text-gray-800 text-sm font-semibold">Download QR image</button>
        )}
        <button onClick={() => navigate('/pay', { state: { appointment: appt } })} className="w-full h-11 mt-2 rounded-lg bg-primary-600 text-white text-sm font-semibold">
          I've paid — upload proof
        </button>
        {isDev() && (
          <button onClick={async () => { try { await mockPay(supabase, appt.id); navigate('/book/success', { state: { appointment: appt } }) } catch (ex) { alert(ex.message) } }}
                  className="w-full h-10 mt-2 rounded-lg border-2 border-dashed border-gray-800 text-gray-800 text-xs font-bold">
            DEV: mock GCash — mark paid now
          </button>
        )}
        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
      </div>
    </div>
  )
}
