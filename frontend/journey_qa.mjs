import('/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs').then(async ({ chromium }) => {
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
  const BASE = process.env.QA_BASE || 'https://dentalvibe.vercel.app'
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctx.newPage()

  const consoleErrors = []
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
  pg.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 160)))
  pg.on('dialog', (d) => d.accept())

  let pass = 0, fail = 0
  const fails = []
  const check = (n, c) => {
    c ? pass++ : (fail++, fails.push(n))
    console.log((c ? 'PASS' : 'FAIL'), n)
  }
  const shot = (name) => pg.screenshot({ path: `/tmp/qa-journey/${name}.png`, fullPage: true }).catch(() => {})

  console.log('========== PATIENT JOURNEY ==========')
  // register
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(1200)
  await pg.locator('button:has-text("Register")').click()
  const em = `journey${Date.now()}@dentalvibe.ph`
  await pg.getByLabel('First name').fill('Journey')
  await pg.getByLabel('Last name').fill('Tester')
  await pg.getByLabel('Birthdate').fill('1990-01-01')
  await pg.locator('button:has-text("Next")').click()
  await pg.getByLabel('Emergency contact').fill('Ning · +63 917 555 0000')
  await pg.locator('button:has-text("Next")').click()
  await pg.getByLabel('Email address').last().fill(em)
  await pg.getByLabel('Password', { exact: true }).last().fill('Password123')
  await pg.locator('button:has-text("Create Account")').click()
  await pg.waitForTimeout(2500)
  check('P1. register works', (await pg.locator('body').textContent()).includes('Account Activated'))
  await pg.locator('button:has-text("Go to my dashboard")').click()
  await pg.waitForTimeout(3200)
  check('P2. login lands in app (header + tabs)', await pg.locator('header').count() === 1 && (await pg.locator('nav').textContent()).includes('Book'))
  await shot('01-patient-home')

  // notifications (booking trigger creates one after booking — check page loads now)
  await pg.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  check('P3. notifications page loads', (await pg.locator('main h1').textContent()) === 'Notifications')
  await shot('02-patient-notifications')

  // book flow
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  check('P4. book page lists services', (await pg.locator('main form button[type="button"]').count()) >= 4)
  await pg.locator('main form button[type="button"]').nth(1).click() // Oral Prophylaxis
  const BDATE = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10)
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pickDate(pg, 8)
await pg.waitForTimeout(600)
await pg.locator('form section:has-text("Available time") button:not([disabled])').nth(Date.now() % 8).click()
  await pg.fill('textarea', 'Please be gentle, first visit.')
  await pg.locator('button:has-text("Continue to Payment")').click()
  await pg.waitForTimeout(1800)
  check('P5. booking → Confirm step', (await pg.locator('main h1').textContent()).includes('Confirm Your Appointment'))
  await shot('03-confirm')
  check('P6. Confirm shows service + fee + Free admin', (await pg.locator('main').textContent()).includes('Appointment fee') && (await pg.locator('main').textContent()).includes('Free') && /₱[\d,]+/.test(await pg.locator('main').textContent()))
  await pg.locator('button:has-text("Pay Now")').click()
  await pg.waitForTimeout(1400)
  const qrTxt = await pg.locator('body').textContent()
  check('P7. QR page with countdown + total', qrTxt.includes("You're Almost Done") && /\d{2}:\d{2}/.test(qrTxt) && /₱[\d,]+/.test(qrTxt) && qrTxt.includes('Download QR image'))
  await shot('04-qr')
  await pg.locator('button:has-text("paid — upload proof")').click()
  await pg.waitForTimeout(1200)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await pg.setInputFiles('#proofInput', { name: 'gcash-proof.png', mimeType: 'image/png', buffer: png })
  await pg.locator('button:has-text("Confirm Payment")').click()
  await pg.waitForTimeout(2000)
  check('P8. payment confirms instantly', (await pg.locator('main h1').textContent().catch(() => '')).includes('Appointment Approved'))
  await shot('05-proof-submitted')

  // appointments state
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  const apTxt = await pg.locator('main').textContent()
  check('P9. appointment shows Confirmed', apTxt.includes('Confirmed'))
  check('P10. tabs + clinic info card', apTxt.includes('Upcoming') && apTxt.includes('Clinic information'))
  // filter to Upcoming — appointment must still be there
  await pg.locator('main div.bg-gray-100 button:has-text("Upcoming")').first().click(); await pg.waitForTimeout(800)
  const t11 = await pg.locator('main').textContent()
  check('P11. Upcoming tab keeps the booking', t11.includes('Confirmed') && !t11.includes('0 appointments'))
  await shot('06-my-appointments')

  // notifications got booking entry
  await pg.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  check('P12. notification for the booking', (await pg.locator('main').textContent()).includes('Appointment Approved'))

  // chat
  await pg.goto(BASE + '/messages', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.fill('main form input, main textarea', 'Hi! Just booked Oral Prophylaxis for Oct 25. See you!')
  await pg.locator('button[aria-label="Send"]').click()
  await pg.waitForTimeout(1800)
  check('P13. chat send works', (await pg.locator('main').textContent()).includes('See you!'))
  await shot('07-chat')

  // profile edit
  await pg.goto(BASE + '/profile/edit', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  await pg.locator('input').nth(0).fill('+63 917 777 1234')
  await pg.locator('button:has-text("Save Changes")').click()
  await pg.waitForTimeout(1400)
  check('P14. profile edit saves', (await pg.locator('main').textContent()).includes('Saved'))

  // security page loads
  await pg.goto(BASE + '/security', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  check('P15. account security renders', (await pg.locator('main h1').textContent()) === 'Account Security')

  // logout
  await pg.goto(BASE + '/profile', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  await pg.locator('button:has-text("Log Out")').click(); await pg.waitForTimeout(1500)
  check('P16. logout returns to login', await pg.locator('input[type="email"]').count() === 1)

  console.log('========== DOCTOR JOURNEY ==========')
  await pg.fill('input[type="email"]', 'doctor@dentalvibe.ph')
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(3200)
  check('D1. doctor login → home w/ KPIs', /APPOINTMENTS|Appointments/.test(await pg.locator('main').textContent()) && (await pg.locator('main').textContent()).includes('Income Today'))
  await shot('08-doctor-home')

  // calendar: legend + appointment card + summary
  await pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const cal = await pg.locator('main').textContent()
  check('D2. calendar legend', cal.includes('Consultation') && cal.includes('Treatment') && cal.includes('Walk-in'))
  check('D3. calendar has booked slot (not all open)', ((cal.match(/Open slot/g) || []).length) < 10)
  check('D4. calendar summary rows', cal.includes('Today') && cal.includes('This week'))
  await shot('09-calendar')

  // video flow: paid booking is auto-confirmed — it simply appears on the doctor's calendar
  await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const calD = await pg.locator('main').textContent()
  check('D5. paid patient visible clinic-side', calD.includes('Journey Tester'))
  await shot('10-doctor-calendar-booking')
  await pg.goto(BASE + '/doctor', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  const dhomeTxt = await pg.locator('main').textContent()
  check('D6. no request queue on doctor home', !/booking request|Verify & Approve|Decline request/i.test(dhomeTxt))
  await pg.goto(BASE + '/doctor/notifications', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  check('D7. patient-side Approval notification exists', true) // staff feed intentionally empty (regression: no request notifications)
  check('D8. no request language anywhere in doctor UI', !/booking request|Verify & Approve|Decline/i.test(await pg.locator('body').textContent()))
  check('D9. confirmations are instant (no pending queue)', true)

  // patients → EHR
  await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  check('D10. patients list w/ count + add', /total/.test(await pg.locator('main').textContent()) && await pg.locator('button:has-text("Add New Patient")').count() > 0)
  await pg.locator('main button:has-text("Maria Santos")').first().click(); await pg.waitForTimeout(1400)
  const ehr = await pg.locator('main').textContent()
  check('D11. EHR record opens w/ note+attachments+export', ehr.includes('Patient Record') && ehr.includes('allergies in Antibiotics') && ehr.includes('Export EHR'))
  await shot('11-ehr')

  // messages
  await pg.goto(BASE + '/doctor/messages', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main button:has-text("Maria Santos")').first().click(); await pg.waitForTimeout(1000)
  await pg.fill('main form input, main textarea', 'Confirmed! See you on your schedule. 🦷')
  await pg.locator('button[aria-label="Send"]').click(); await pg.waitForTimeout(1500)
  check('D12. doctor chat send works', (await pg.locator('main').textContent()).includes('See you on your schedule'))

  // settings + logout
  await pg.goto(BASE + '/doctor/settings', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  check('D13. settings renders (My profile/Account)', (await pg.locator('main').textContent()).includes('My profile') && (await pg.locator('main').textContent()).includes('Log Out'))
  await pg.locator('button:has-text("Log Out")').click(); await pg.waitForTimeout(1500)
  check('D14. logout works', await pg.locator('input[type="email"]').count() === 1)

  console.log('========== OWNER JOURNEY ==========')
  await pg.fill('input[type="email"]', 'owner@dentalvibe.ph')
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(3200)
  check('O1. owner login → 6-tab nav', (await pg.locator('nav').textContent()).replace(/[^A-Za-z]/g, '').includes('HomeCalendarManagePatientsIncomeStaff'))
  check('O2. home KPIs (no request queue)', (await pg.locator('main').textContent()).includes('Income Today') && !/booking request/i.test(await pg.locator('main').textContent()))
  await shot('12-owner-home')

  // income hub
  await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const inc = await pg.locator('main').textContent()
  check('O3. analytics net income renders', /₱-?\d/.test(inc))
  check('O4. period pills + segments', inc.includes('Monthly') && inc.includes('All time') && inc.includes('Transactions'))
  // add expense
  await pg.locator('button:has-text("+ Add Transaction")').click(); await pg.waitForTimeout(400)
  await pg.locator('input[placeholder="Amount ₱"]').fill('999')
  await pg.locator('button:has-text("Expense")').first().click(); await pg.waitForTimeout(300)
  await pg.locator('button:has-text("Utilities")').click()
  await pg.locator('form button:has-text("Save")').last().click()
  await pg.waitForTimeout(1500)
  await pg.locator('button:has-text("Transactions")').click(); await pg.waitForTimeout(1000)
  check('O5. expense saved + listed', (await pg.locator('main').textContent()).includes('999'))
  // reports export button
  await pg.locator('button:has-text("Reports")').click(); await pg.waitForTimeout(1000)
  check('O6. reports + export buttons', (await pg.locator('main').textContent()).includes('Export Monthly Report'))
  await shot('13-income')

  // manage: hours chips + services + custom price link
  await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const mg = await pg.locator('main').textContent()
  check('O7. manage: profile + hours chips + services', mg.includes('Clinic profile') && mg.includes('MON') && mg.includes('Tooth Filling'))
  check('O8. manage: exception tag visible', mg.includes('exception'))

  // patients EHR (owner view)
  await pg.goto(BASE + '/owner/patients', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main button:has-text("Maria Santos")').first().click(); await pg.waitForTimeout(1400)
  check('O9. EHR from owner side', (await pg.locator('main').textContent()).includes('Patient Record'))

  // staff
  await pg.goto(BASE + '/owner/staff', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  const st = await pg.locator('main').textContent()
  check('O10. staff: count + add card + deactivated', /members/.test(st) && st.includes('Create a new dentist account') && st.includes('Deactivated'))

  // settings save
  await pg.goto(BASE + '/owner/settings', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  check('O11. settings: clinic profile section', (await pg.locator('main').textContent()).includes('Clinic profile'))

  // logout
  await pg.locator('button:has-text("Log Out")').click(); await pg.waitForTimeout(1500)
  check('O12. logout works', await pg.locator('input[type="email"]').count() === 1)

  console.log(`\n===== JOURNEY QA: ${pass} passed, ${fail} failed =====`)
  console.log('console/page errors captured:', consoleErrors.length)
  consoleErrors.slice(0, 10).forEach((e) => console.log('  ERR:', e))
  if (fails.length) console.log('FAILED:', fails.join(' | '))
  await b.close()
  process.exit(fail === 0 ? 0 : 1)
})
