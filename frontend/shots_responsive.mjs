// Responsive visual QA matrix — every route x 6 viewports x 3 roles.
// Screenshots = RGB PNGs into screenshots/responsive/ + programmatic audit lines.
// usage: cd frontend && node shots_responsive.mjs [--vp=390x844] [--role=patient]
import { chromium } from './qa_playwright.mjs'
import fs from 'fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const VPS = [[360, 800], [390, 844], [412, 915], [768, 1024], [1024, 768], [1440, 900]]
const OUT = fileURLToPath(new URL('../screenshots/responsive/', import.meta.url))
fs.mkdirSync(OUT, { recursive: true })

const ROUTES = {
  patient: ['/', '/book', '/book?step=2', '/appointments', '/messages', '/profile', '/profile/edit', '/security', '/settings', '/notifications'],
  doctor: ['/doctor', '/doctor/calendar', '/doctor/patients', '/doctor/messages', '/doctor/security', '/doctor/settings', '/doctor/notifications'],
  owner: ['/owner', '/owner/calendar', '/owner/manage', '/owner/patients', '/owner/income', '/owner/staff', '/owner/notifications', '/owner/settings', '/owner/security'],
}
const TABS = {
  patient: ['Home', 'Appointments', 'Book', 'Messages', 'Profile'],
  doctor: ['Home', 'Calendar', 'Patients', 'Messages'],
  owner: ['Home', 'Calendar', 'Manage', 'Patients', 'Income', 'Staff'],
}
const onlyVp = (process.argv.find((a) => a.startsWith('--vp=')) || '').split('=')[1]
const onlyRole = (process.argv.find((a) => a.startsWith('--role=')) || '').split('=')[1]

const b = await chromium.launch()
const findings = []
const flag = (route, vp, issue, sev) => {
  findings.push({ route, vp, issue, sev })
  console.log(`${sev} | ${route} @ ${vp} :: ${issue}`)
}

async function session(role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctx.newPage()
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', role === 'patient' ? 'maria@dentalvibe.ph' : role + '@dentalvibe.ph')
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2200)
  return ctx
}

for (const role of Object.keys(ROUTES)) {
  if (onlyRole && role !== onlyRole) continue
  const ctx = await session(role)
  for (const [w, h] of VPS) {
    const vp = `${w}x${h}`
    if (onlyVp && vp !== onlyVp) continue
    const pg = await ctx.newPage()
    await pg.setViewportSize({ width: w, height: h })
    const errs = []
    pg.on('pageerror', (e) => errs.push(e.message))
    for (const route of ROUTES[role]) {
      await pg.goto(BASE + route, { waitUntil: 'networkidle' })
      await pg.waitForTimeout(700)
      const name = route.replace(/[\/?=]/g, '_') + `__${vp}.png`
      await pg.screenshot({ path: `${OUT}/${name}`, fullPage: true })
      const audit = await pg.evaluate((tabs) => {
        const out = { hscroll: 0, smallTargets: [], navOk: true, fixedOff: [], tabLabels: [] }
        out.hscroll = document.documentElement.scrollWidth - window.innerWidth
        document.querySelectorAll('button, a[href]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0 && (r.height < 36 || r.width < 28)) {
            out.smallTargets.push((el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 18) + ` ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        })
        const bottomNav = [...document.querySelectorAll('nav')].find((n) => n.className.includes('bottom-0'))
        const side = document.querySelector('aside')
        const desktop = window.innerWidth >= 768
        out.tabLabels = bottomNav && getComputedStyle(bottomNav).display !== 'none'
          ? [...bottomNav.querySelectorAll('button span:last-child')].map((s) => s.textContent)
          : []
        if (desktop) {
          if (!side || getComputedStyle(side).display === 'none') out.navOk = false
          if (bottomNav && getComputedStyle(bottomNav).display !== 'none') out.navOk = false
        } else {
          if (side && getComputedStyle(side).display !== 'none') out.navOk = false
          if (!bottomNav || getComputedStyle(bottomNav).display === 'none') out.navOk = false
        }
        // fixed/sticky bottom elements must not sit under the tab bar
        document.querySelectorAll('.sticky, .fixed').forEach((el) => {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (cs.position === 'fixed' && r.bottom > window.innerHeight + 4 && r.height > 0 && !el.className.includes('inset-0')) {
            out.fixedOff.push((el.className || '').slice(0, 40))
          }
        })
        return out
      }, TABS[role])

      const vpTag = `${route} @ ${vp}`
      if (audit.hscroll > 1) flag(route, vp, `horizontal overflow ${audit.hscroll}px`, 'HIGH')
      if (!audit.navOk) flag(route, vp, desktopOrMobile(w) + ' nav chrome incorrect', 'HIGH')
      if (w < 768) {
        const want = TABS[role].join(',')
        if (audit.tabLabels.join(',') !== want) flag(route, vp, `tabs "${audit.tabLabels.join(',')} != role tabs`, 'HIGH')
      }
      if (audit.smallTargets.length > 2) flag(route, vp, `small tap targets: ${audit.smallTargets.slice(0, 3).join(' | ')}`, 'MED')
      for (const f of audit.fixedOff) flag(route, vp, `fixed element off-viewport: ${f}`, 'MED')
      if (errs.length) flag(route, vp, `pageerror: ${errs[0].slice(0, 70)}`, 'HIGH')
      errs.length = 0
    }
    await pg.close()
  }
  await ctx.close()
}

function desktopOrMobile(w) { return w >= 768 ? 'desktop' : 'mobile' }

const counts = findings.reduce((a, f) => (a[f.sev] = (a[f.sev] || 0) + 1, a), {})
console.log(`\n===== RESPONSIVE AUDIT: ${findings.length} findings ${JSON.stringify(counts)} =====`)
fs.writeFileSync(fileURLToPath(new URL('../audit_responsive.json', import.meta.url)), JSON.stringify(findings, null, 2))
await b.close()
