// Shared formatting helpers
export const fmtTime12 = (t) => {
  // '08:00' → '8:00 AM'
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`
}

export const peso = (v) => '₱' + Number(v ?? 0).toLocaleString('en-US')

export const dayNum = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
