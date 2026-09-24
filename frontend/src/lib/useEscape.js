import { useEffect, useRef } from 'react'

// Dialog behavior in one place: Escape-to-close, focus into the dialog, Tab cycling, focus restore.
// ponytail: single-modal app — resolves '[role="dialog"]' fresh per event instead of threading refs.
// Stacked modals would need a ref chain; upgrade then.
export default function useEscape(onClose, open = true) {
  const cb = useRef(onClose)
  cb.current = onClose
  useEffect(() => {
    // ponytail: mount-scoped — onClose via ref so typing in the dialog never re-runs focus logic
    const prev = document.activeElement
    const dlg = () => document.querySelector('[role="dialog"]')
    const focusables = () =>
      [...(dlg()?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((el) => !el.disabled && el.offsetParent !== null)
    const first = focusables()[0]
    if (first) first.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { cb.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) return
      const head = f[0], tail = f[f.length - 1]
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus() }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prev?.focus) prev.focus()
    }
  }, [open])
}
export { useEscape as useDialog }
