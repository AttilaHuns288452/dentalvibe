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

// ponytail: PDF export = browser print dialog (Save as PDF). No jsPDF dep needed.
export function printReport(title, lines) {
  let w = window.open('', '_blank', 'width=480,height=720')
  if (!w) {
    // popup-blocked fallback: hidden iframe print
    const ifr = document.createElement('iframe')
    ifr.style.display = 'none'
    document.body.appendChild(ifr)
    w = ifr.contentWindow
  }
  w.document.write(`<!doctype html><title>${title}</title><style>body{font:13px/1.5 system-ui;padding:24px;color:#17242b}h1{font-size:16px}pre{white-space:pre-wrap;font:12px/1.6 system-ui}</style><h1>${title}</h1><pre>${lines.join('\n')}</pre>`)
  w.document.close()
  w.focus()
  w.print()
}
