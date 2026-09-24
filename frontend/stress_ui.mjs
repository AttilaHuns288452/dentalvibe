import('/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs').then(async ({ chromium }) => {
  const BASE = 'https://dentalvibe.vercel.app'
  const b = await chromium.launch()
  const R = []
  const t = (name, bad, detail = '') => R.push(`${bad ? 'BREAK' : 'ok   '} | ${name}${detail ? ' :: ' + detail : ''}`)
  const errs = []

  const login = async (ctx, email, pw = 'password123') => {
    const pg = await ctx.newPage()
    await pg.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await pg.getByLabel('Email address').fill(email)
    await pg.getByLabel('Password').fill(pw)
    await pg.locator('form button:has-text("Sign In")').last().click()
    await pg.waitForTimeout(2500)
    return pg
  }

  // ===== AUTH EDGES =====
  let ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  let pg = await ctx.newPage()
  pg.on('pageerror', (e) => errs.push('PAGE: ' + e.message))
  await pg.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await pg.getByLabel('Email address').fill('maria@dentalvibe.ph')
  await pg.getByLabel('Password').fill('wrongpass')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(1500)
  t('invalid password shows error', !(await pg.locator('body').textContent()).match(/invalid|incorrect/i), 'no error text')
  t('empty creds submit blocked (required attr)', (await pg.locator('input[type="email"]:invalid').count()) === 0, 'browser validation')
  await pg.close()

  // session persistence + back-after-logout + protected deep link
  pg = await login(ctx, 'maria@dentalvibe.ph')
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
  await pg.reload({ waitUntil: 'networkidle' })
  t('session survives refresh', (await pg.locator('header').count()) === 0, 'bounced to login?')
  await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  t('patient deep-link /owner/income redirected', (await pg.locator('body').textContent()).includes('Income Analytics'), 'OWNER PAGE VISIBLE')
  await pg.goto(BASE + '/profile', { waitUntil: 'networkidle' })
  await pg.locator('button:has-text("Log Out")').click()
  await pg.waitForTimeout(1500)
  await pg.goBack().catch(() => {})
  await pg.waitForTimeout(800)
  t('back button after logout stays logged out', (await pg.locator('header').count()) > 0, 'APP VISIBLE AFTER LOGOUT')
  await pg.close()

  // ===== PATIENT FORMS / NEGATIVE =====
  pg = await login(ctx, 'maria@dentalvibe.ph')
  // profile edit: special chars + long string + double submit
  await pg.goto(BASE + '/profile/edit', { waitUntil: 'networkidle' }).catch(() => {})
  const nameInput = pg.locator('input').first()
  if (await nameInput.count()) {
    await nameInput.fill('<script>alert(1)</script>' + 'X'.repeat(300))
    await pg.locator('button:has-text("Save")').last().click()
    await pg.waitForTimeout(1200)
    await pg.reload({ waitUntil: 'networkidle' })
    const v = await pg.locator('input').first().inputValue()
    t('profile long+HTML name persists (no crash)', v.includes('script') || v.length < 5, 'saved len=' + v.length)
    t('XSS escaped (no dialog fired)', !errs.some(e => e.includes('alert')), 'errs=' + errs.slice(0, 2))
    // restore
    await nameInput.fill('Maria Santos')
    await pg.locator('button:has-text("Save")').last().click()
    await pg.waitForTimeout(800)
  } else {
    t('profile edit page reachable', true, '/profile/edit not found — skipped')
  }
  // booking validation: submit w/o service
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('button:has-text("Continue to Payment")').click()
  await pg.waitForTimeout(600)
  t('booking empty submit blocked', !(await pg.locator('body').textContent()).includes('Pick a service'), 'NO ERROR SHOWN')
  // past date
  await pg.fill('input[type="date"]', '2020-01-01').catch(() => {})
  t('past date not selectable (min attr)', (await pg.locator('input[type="date"]').getAttribute('min')) === new Date().toISOString().slice(0, 10))
  // double-click double submit → count created rows later via API; here: rapid clicks don't crash
  await pg.locator('main form button[type="button"]').first().click()
  await pg.fill('input[type="date"]', new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))
  await pg.waitForTimeout(700)
  await pg.locator('form section:has-text("Available time") button:not([disabled])').first().click()
  const dbl = pg.locator('button:has-text("Continue to Payment")')
  await dbl.click({ force: true })
  await dbl.click({ force: true }).catch(() => {})
  await pg.waitForTimeout(2500)
  const url1 = pg.url()
  t('double-click submit lands once (idempotent UX)', !url1.includes('confirm') || true, 'url=' + url1.split('.app')[1])
  // search no-result / case
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
  await pg.fill('input[placeholder="Search appointments…"]', 'zzzznotfound')
  await pg.waitForTimeout(500)
  t('appointments search no-result state', (await pg.locator('main').textContent()).includes('0 appointments'))
  await pg.fill('input[placeholder="Search appointments…"]', 'TOOTH')
  await pg.waitForTimeout(500)
  const caseTxt = await pg.locator('main').textContent()
  t('appointments search case-insensitive', !caseTxt.includes('0 appointments'), 'TOOTH upper got 0')
  await pg.close()

  // ===== CROSS-ROLE SYNC (Scenario A/B/C) =====
  const ctxP = await b.newContext({ viewport: { width: 390, height: 844 } })
  const ctxD = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pgP = await login(ctxP, 'carlo@dentalvibe.ph')
  const pgD = await login(ctxD, 'doctor@dentalvibe.ph')
  // patient books + pays
  await pgP.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pgP.locator('main form button[type="button"]').first().click()
  const CD = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)
  await pgP.fill('input[type="date"]', CD)
  await pgP.waitForTimeout(700)
  await pgP.locator('form section:has-text("Available time") button:not([disabled])').first().click()
  await pgP.locator('button:has-text("Continue to Payment")').click()
  await pgP.waitForTimeout(1500)
  await pgP.locator('button:has-text("Pay Now")').click()
  await pgP.waitForTimeout(1200)
  await pgP.locator('button:has-text("paid — upload proof")').click()
  await pgP.waitForTimeout(800)
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd60000000049454e44ae426082', 'hex')
  await pgP.setInputFiles('#proofInput', { name: 'p.png', mimeType: 'image/png', buffer: png })
  await pgP.locator('button:has-text("Confirm Payment")').click()
  await pgP.waitForTimeout(2500)
  t('A: patient pays -> instant confirm UI', !(await pgP.locator('body').textContent()).includes('Appointment Approved'), 'no confirmation')
  // doctor sees it WITHOUT refresh of a fresh load (stale-state test: doctor reloads)
  await pgD.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
  await pgD.reload({ waitUntil: 'networkidle' })
  t('B: doctor sees new patient data after reload', !(await pgD.locator('main').textContent()).includes('Carlo Bautista'), 'Carlo missing')
  // doctor cancels?? (should be patient-only for own; doctor CAN cancel via staff update — policy allows; by design?)
  await pgP.close(); await pgD.close()

  // ===== RESPONSIVE =====
  for (const [w, h, label] of [[360, 800, '360 mobile'], [768, 1024, '768 tablet'], [1440, 900, '1440 desktop']]) {
    const c = await b.newContext({ viewport: { width: w, height: h } })
    const p = await login(c, 'owner@dentalvibe.ph')
    let overflow = false
    for (const route of ['/', '/owner/manage', '/owner/income', '/owner/staff', '/owner/patients']) {
      await p.goto(BASE + route, { waitUntil: 'networkidle' })
      const o = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      if (o) overflow = true
    }
    t(`responsive ${label} — no horizontal overflow`, overflow)
    await p.close()
  }

  // ===== EVERY-BUTTON SPOT SWEEP (owner surfaces) =====
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } })
  const po = await login(c2, 'owner@dentalvibe.ph')
  await po.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  // export button (popup-blocker risk): click and see if anything happens
  const exp = po.locator('button[aria-label="Export report"]')
  if (await exp.count()) {
    const [popup] = await Promise.all([po.waitForEvent('popup', { timeout: 3000 }).catch(() => null), exp.click()])
    t('export button opens print window', !popup, 'no popup (popup-blocked or dead)')
  }
  // add transaction double-submit
  await po.locator('button:has-text("Add Transaction")').click()
  await po.waitForTimeout(400)
  if (await po.locator('input').first().count()) {
    await po.locator('input:not([type="number"])').first().fill('Stress TX ' + Date.now())
    const amt = po.locator('input[type="number"]')
    if (await amt.count()) await amt.first().fill('100')
    const save = po.locator('button:has-text("Save")').last()
    await save.click({ force: true })
    await save.click({ force: true }).catch(() => {})
    await po.waitForTimeout(1500)
    t('add-transaction double-click (dupe row?)', true, 'row count checked via API later')
  }
  await po.close()

  console.log(R.join('\n'))
  console.log('\npage errors:', errs.length ? errs.slice(0, 6).join(' | ') : 'none')
  await b.close()
})
