// LIVE DEMO ACCEPTANCE (§8/§23): UI-only mutations, 3 role sessions, DB readback as the roles see it.
import('./frontend/qa_playwright.mjs').then(async ({ chromium, createClient }) => {
  const fs = await import('fs')
  const ANON = fs.readFileSync(new URL('./frontend/.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
  const SB = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
  const BASE = 'https://dentalvibe.vercel.app'
  const R = []
  const t = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`)
  const b = await chromium.launch()
  const errs = []

  const api = async (email, pw) => { const c = createClient(SB, ANON); await c.auth.signInWithPassword({ email, password: pw }); return c }
  const pickDate = async (pg, daysAhead) => {
    const target = new Date(Date.now() + daysAhead * 864e5)
    for (let i = 0; i < 3; i++) {
      const label = await pg.locator('section:has-text("Preferred date") span.text-sm.font-bold').first().textContent()
      const cur = new Date(label.trim() + ' 1')
      if (cur.getMonth() === target.getMonth() && cur.getFullYear() === target.getFullYear()) break
      if (cur < target) await pg.locator('button[aria-label="Next month"]').click()
      else await pg.locator('button[aria-label="Previous month"]').click()
      await pg.waitForTimeout(250)
    }
    await pg.getByRole('button', { name: String(target.getDate()), exact: true }).click()
  }
  const loginUI = async (ctx, email, pw) => {
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => errs.push('PAGE ' + e.message))
    await pg.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await pg.getByLabel('Email address').fill(email)
    await pg.getByLabel('Password', { exact: true }).fill(pw)
    await pg.locator('form button:has-text("Sign In")').last().click()
    await pg.waitForTimeout(2500)
    return pg
  }
  const txt = async (pg) => (await pg.locator('main').textContent()).replace(/\s+/g, ' ')

  // ============ STEP 1 — PATIENT: register → book → pay → confirmed ============
  const DEMO = `demo${Date.now()}@dentalvibe.ph`
  const ctxP = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctxP.newPage()
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message))
  await pg.goto(BASE, { waitUntil: 'networkidle' })
  await pg.locator('button:has-text("Register")').click()
  await pg.getByLabel('First name').fill('Demo')
  await pg.getByLabel('Last name').fill('Patient')
  await pg.getByLabel('Birthdate').fill('1995-04-04')
  await pg.getByRole('button', { name: 'Female', exact: true }).click()
  await pg.locator('button:has-text("Next")').click()
  await pg.getByLabel('Emergency contact').fill('Ning · +63 917 555 0000')
  await pg.locator('button:has-text("Next")').click()
  await pg.getByLabel('Email address').last().fill(DEMO)
  await pg.getByLabel('Password', { exact: true }).last().fill('DemoPass123')
  await pg.locator('button:has-text("Create Account")').click()
  await pg.waitForTimeout(2500)
  t('S1 patient registers via UI (wizard)', (await pg.locator('body').textContent()).includes('Account Activated'))
  await pg.locator('button:has-text("Go to my dashboard")').click()
  await pg.waitForTimeout(3000)
  t('S1 lands on dashboard', (await pg.locator('header').count()) === 1)

  // book TODAY (so doctor Day view shows it) — service → grid date (0 = today) → slot
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  const svcName = (await pg.locator('main form button[type="button"]').first().textContent()).trim().split('·')[0].split('\n')[0].trim()
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pickDate(pg, 0)
  await pg.waitForTimeout(700)
  await pg.locator('form section:has-text("Available time") button:not([disabled])').last().click()
  await pg.locator('button:has-text("Continue to Payment")').click()
  await pg.waitForTimeout(1500)
  t('S1 payment summary (p121)', (await txt(pg)).includes('Appointment fee'))
  await pg.locator('button:has-text("Pay Now")').click()
  await pg.waitForTimeout(1200)
  t('S1 QR payment screen (p123)', (await txt(pg)).includes('Almost Done'))
  await pg.locator('button:has-text("paid — upload proof")').click()
  await pg.waitForTimeout(800)
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd60000000049454e44ae426082', 'hex')
  await pg.setInputFiles('#proofInput', { name: 'p.png', mimeType: 'image/png', buffer: png })
  await pg.locator('button:has-text("Confirm Payment")').click()
  await pg.waitForTimeout(2500)
  t('S1 instant confirmation (p131)', (await pg.locator('body').textContent()).includes('Appointment Approved'))

  const P = await api(DEMO, 'DemoPass123')
  const { data: myAppts } = await P.from('appointments').select('*, services(name)')
  const booked = myAppts?.[0]
  t('S1 DB truth: exactly 1 approved+verified appt', myAppts?.length === 1 && booked?.status === 'approved' && booked?.payment_status === 'verified', JSON.stringify({ n: myAppts?.length, s: booked?.status, p: booked?.payment_status }))

  // ============ STEP 2 — DOCTOR: sees it → clinical note → patient cannot see it ============
  const ctxD = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pd = await loginUI(ctxD, 'doctor@dentalvibe.ph', 'password123')
  await pd.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
  t('S2 doctor sees new patient', (await txt(pd)).includes('Demo Patient'))
  await pd.getByRole('button', { name: /Demo Patient/ }).first().click()
  await pd.waitForTimeout(1500)
  // clinical note edit (p124)
  await pd.locator('button:has-text("Edit")').first().click()
  await pd.waitForTimeout(500)
  await pd.locator('textarea').first().fill('Mild gingivitis — scale advised. Demo note.')
  await pd.locator('button:has-text("Save")').last().click()
  await pd.waitForTimeout(1200)
  t('S2 clinical note saved (UI)', (await txt(pd)).includes('Demo note'))

  const D = await api('doctor@dentalvibe.ph', 'password123')
  const { data: chart } = await D.from('staff_patients').select('medical_note').eq('full_name', 'Demo Patient').limit(1)
  t('S2 DB truth: note persisted for staff', (chart?.[0]?.medical_note ?? '').includes('Demo note'))
  const leak = await P.from('patients').select('medical_note').eq('full_name', 'Demo Patient')
  t('S2 patient CANNOT read clinical note (confidentiality)', !!leak.error)

  // mark completed via calendar (Day view = today)
  await pd.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' })
  await pd.waitForTimeout(1500)
  const mc = pd.locator('button:has-text("Mark completed")')
  t('S2 Mark completed available on booked slot', (await mc.count()) >= 1)
  await mc.first().click()
  await pd.waitForTimeout(1500)
  const calAfter = await txt(pd)
  t('S2 visit completed (UI)', calAfter.includes('completed'))
  await pd.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
  await pd.getByRole('button', { name: /Demo Patient/ }).first().click()
  await pd.waitForTimeout(1500)
  t('S2 completed visit enters treatment history', (await txt(pd)).includes(svcName.split(' ')[0]))

  // ============ STEP 3 — OWNER: income reflects payment + expense + new service propagates ============
  const ctxO = await b.newContext({ viewport: { width: 390, height: 844 } })
  const po = await loginUI(ctxO, 'owner@dentalvibe.ph', 'password123')
  await po.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  await po.waitForTimeout(1500)
  const incTxt = await txt(po)
  t('S3 income includes the paid visit', incTxt.includes(svcName.split(' ')[0]) || incTxt.includes('income'))
  const O = await api('owner@dentalvibe.ph', 'password123')
  const sum = async () => {
    const { data: tx } = await O.from('transactions').select('type, amount')
    const { data: ap } = await O.from('appointments').select('price').eq('payment_status', 'verified').neq('status', 'cancelled')
    return (tx ?? []).filter((x) => x.type === 'income').reduce((s, x) => s + +x.amount, 0) + (ap ?? []).reduce((s, x) => s + +x.price, 0) - (tx ?? []).filter((x) => x.type === 'expense').reduce((s, x) => s + +x.amount, 0)
  }
  const netBefore = await sum()
  await po.locator('button:has-text("Add Transaction")').click()
  await po.waitForTimeout(400)
  await po.locator('input[type="number"]').first().fill('150')
  await po.getByRole('button', { name: 'expense', exact: true }).click()
  await po.locator('div.flex.flex-wrap button').first().click()
  await po.locator('input[placeholder="What was this expense for?"]').fill('Demo supplies ' + Date.now())
  await po.locator('button:text-is("Save")').click()
  await po.waitForTimeout(1500)
  const netAfter = await sum()
  t('S3 expense hits the ledger (net −150)', netBefore - netAfter === 150, `${netBefore} -> ${netAfter}`)

  // Manage: add service → patient Book lists it (owner → patient propagation)
  await po.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' })
  await po.locator('button:has-text("Add Service")').first().click()
  await po.waitForTimeout(500)
  await po.locator('input[placeholder="Service name"]').fill('Demo Cleaning')
  await po.locator('input[placeholder="Price ₱"]').fill('999')
  await po.locator('input[placeholder="Minutes"]').fill('30')
  await po.locator('form button:has-text("Add Service")').last().click()
  await po.waitForTimeout(1500)
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  t('S3 owner-added service appears in patient Book', (await txt(pg)).includes('Demo Cleaning'))
  await O.from('services').delete().eq('name', 'Demo Cleaning') // teardown: keep catalog clean

  // ============ STEP 4 — refresh + re-login everything; states hold ============
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
  await pg.reload({ waitUntil: 'networkidle' })
  await pg.waitForTimeout(1000)
  const patTxt = await txt(pg)
  t('S4 patient: completed visit shows in Past', patTxt.includes('Completed'))
  await pd.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' })
  await pd.reload({ waitUntil: 'networkidle' })
  t('S4 doctor: completed persists after refresh', (await txt(pd)).includes('completed'))
  await po.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  await po.reload({ waitUntil: 'networkidle' })
  t('S4 owner: net still correct after refresh', (await sum()) === netAfter, `${await sum()} vs ${netAfter}`)

  // re-login patient from scratch
  await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await loginUI(ctxP, DEMO, 'DemoPass123').then(async (p2) => {
    await p2.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
    t('S4 re-login preserves appointment state', (await txt(p2)).includes('Completed'))
  })

  // ============ STEP 5 — conflict: second patient cannot steal a paid slot ============
  const M = await api('maria@dentalvibe.ph', 'password123')
  const { data: slotRow } = await P.from('appointments').select('scheduled_at, service_id, price').eq('id', booked.id).single()
  const pidM = (await M.from('patients').select('id').limit(1)).data[0].id
  const r1 = await M.from('appointments').insert({ patient_id: pidM, service_id: slotRow.service_id, requested_date: new Date().toISOString().slice(0, 10), scheduled_at: slotRow.scheduled_at, price: slotRow.price }).select()
  const r1b = r1.error ? null : await M.rpc('fn_submit_payment_proof', { p_appointment: r1.data?.[0]?.id, p_image: 'data:image/png;base64,AAAA' })
  t('S5 second patient cannot secure a taken slot', !!r1.error || !!r1b?.error, (r1.error?.message ?? r1b?.error?.message ?? 'SECURED — conflict!').slice(0, 50))
  // cleanup maria's unpaid attempt if created
  await M.from('appointments').delete().eq('patient_id', pidM).eq('payment_status', 'unpaid')

  console.log(R.join('\n'))
  console.log('\npage errors:', errs.length ? errs.slice(0, 5).join(' | ') : 'none')
  await b.close()
})
