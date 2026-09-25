// push.js — Web Push subscription lifecycle (the public half).
// The VAPID PUBLIC key is safe in the browser; the private key lives only in
// the server config (service_config / edge functions). Identity is always
// server-derived from the session — we never send a user_id.
import { supabase } from './api'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const vapidConfigured = () => VAPID_PUBLIC.length > 20

// iOS/iPadOS only supports Web Push for HOME-SCREEN installed web apps (16.4+)
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function callRegister(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  let lastErr = null
  for (let i = 0; i < 2; i++) { // one retry: edge function cold starts are transient
    const res = await supabase.functions.invoke('push-register', {
      body: payload,
      headers: { Authorization: 'Bearer ' + session.access_token },
    })
    if (!res.error) return res.data
    lastErr = res.error
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error(lastErr.message)
}

// Enable: permission (user gesture) → subscribe → register with the server.
// Only claims success AFTER the server confirms (§5).
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (!vapidConfigured()) return { ok: false, reason: 'not-configured' }
  if (isIos() && !isStandalone()) return { ok: false, reason: 'ios-not-installed' }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' }

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) })
    }
    await callRegister({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.toJSON().keys.p256dh, auth: sub.toJSON().keys.auth },
      user_agent: navigator.userAgent,
    })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'register-failed' }
  }
}

// Disable on THIS device (also used on logout so the device never keeps
// receiving the next account's notifications).
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      await callRegister({ action: 'unregister', endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe()
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function pushStatus() {
  if (!pushSupported()) return 'unsupported'
  if (isIos() && !isStandalone()) return 'ios-not-installed'
  if (!vapidConfigured()) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null)
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return sub ? 'enabled' : 'disabled'
}

// §15: app badge = in-app unread count where the platform supports it
export function setAppBadge(count) {
  try {
    if (navigator.setAppBadge) {
      if (count > 0) navigator.setAppBadge(count).catch(() => {})
      else navigator.clearAppBadge().catch(() => {})
    }
  } catch { /* platform without badge support — fine */ }
}
