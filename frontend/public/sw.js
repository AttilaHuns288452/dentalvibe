// ponytail: minimal service worker — cache shell, network-first everything.
// Upgrade to Workbox/vite-plugin-pwa when offline-first flows actually matter.
const CACHE = 'dar-dental-v2'
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg']

// ── Web Push: persistent OS-level notifications ─────────────────────────────
// Payload: { title, body, route, icon }. The DB notification row is the source
// of truth; this is only the delivery surface (§8).
self.addEventListener('push', (e) => {
  let p = {}
  try { p = e.data ? e.data.json() : {} } catch { p = { body: e.data ? e.data.text() : '' } }
  const title = p.title || 'DentalVibe'
  e.waitUntil(
    self.registration.showNotification(title, {
      body: p.body || '',
      icon: p.icon || '/icon.svg',
      badge: '/icon.svg',
      data: { route: p.route || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const route = (e.notification.data && e.notification.data.route) || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // SPA deep link: ask the page to navigate, or navigate directly
          try { c.navigate(route) } catch { c.postMessage({ type: 'push-navigate', route }) }
          return c.focus()
        }
      }
      return self.clients.openWindow(route)
    }),
  )
})

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return // never intercept Supabase/API
  // hashed build assets are immutable — cache-first (repeat visits skip the 600KB refetch)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })),
    )
    return
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/index.html')))
  )
})
