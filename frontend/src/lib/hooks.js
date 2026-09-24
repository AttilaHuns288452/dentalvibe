import { useCallback, useEffect, useRef, useState } from 'react'

// Small navigation/state hooks shared by screens (#44/#45/#50/#52/#53).

// survives Back/Forward/remount — search, tabs, booking drafts
export function useStickyState(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = sessionStorage.getItem(key); return s === null ? initial : JSON.parse(s) } catch { return initial }
  })
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)) } catch {} }, [key, v])
  return [v, setV]
}

// revalidate when the tab becomes visible again (#50) — not on every render
export function useRevalidateOnVisible(fn) {
  const cb = useRef(fn)
  cb.current = fn
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') cb.current() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
}

// warn on refresh/close with a dirty form (#53). ponytail: SPA Back intentionally
// discards drafts (restored via useStickyState where wanted); upgrade to a router
// blocker if in-nav warnings are ever required.
export function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
}

// one in-flight mutation per button (#49) — returns [run, busy]
export function useSubmit(fn) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const run = useCallback(async (...a) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await fn(...a) } finally { lock.current = false; setBusy(false) }
  }, [fn])
  return [run, busy]
}
