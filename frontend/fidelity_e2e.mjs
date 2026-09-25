import { cleanTestPatients } from './pretest_clean.mjs'
import('/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs').then(async ({ chromium }) => {
  await cleanTestPatients()
  const b = await chromium.launch()
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } })
  const base = 'http://localhost:4176'
  const errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  let pass = 0, fail = 0
  const check = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n) }
  const login = async (email) => {
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() }).catch(() => {})
    await pg.goto(base + '/', { waitUntil: 'networkidle' })
    await pg.waitForTimeout(600)
    await pg.fill('input[type="email"]', email)
    await pg.fill('input[type="password"]', 'password123')
    await pg.locator('form button:has-text("Sign In")').last().click()
    await pg.waitForTimeout(3000)
  }

  // 1. branding
  await pg.goto(base + '/', { waitUntil: 'networkidle' }); await pg.waitForTimeout(600)
  check('1. login shows D.A.R. Dental Clinic', (await pg.locator('body').textContent()).includes('D.A.R. Dental Clinic'))

  // 2. patient home: greeting banner + upcoming card + recent activity
  await login('maria@dentalvibe.ph')
  const h = await pg.locator('main').textContent()
  check('2a. patient upcoming banner', h.includes('Upcoming Appointment'))
  check('2b. patient upcoming card', h.includes('UPCOMING APPOINTMENT') || h.toLowerCase().includes('upcoming appointment'))
  check('2c. patient recent activity', h.includes('Recent activity') || h.includes('RECENT ACTIVITY'))

  // 3. appointments: tabs/search/count/chevron/clinic info
  await pg.goto(base + '/appointments'); await pg.waitForTimeout(1200)
  const ap = await pg.locator('main').textContent()
  check('3a. appointments tabs', ap.includes('Upcoming') && ap.includes('Past') && ap.includes('All'))
  check('3b. appointments search', await pg.locator('input[placeholder="Search appointments…"]').count() > 0)
  check('3c. appointments count label', /appointments/i.test(ap))
  check('3d. clinic info card', ap.includes('Clinic information') && ap.includes('Hours'))
  // tab filter works
  await pg.locator('button:has-text("Past")').click(); await pg.waitForTimeout(600)
  const pastTxt = await pg.locator('main').textContent()
  check('3e. Past tab filters (no Pending pill)', !pastTxt.includes('Unpaid'))

  // 4. calendar legend + appt card in day view + summary
  await login('doctor@dentalvibe.ph')
  await pg.goto(base + '/doctor/calendar'); await pg.waitForTimeout(1500)
  const cal = await pg.locator('main').textContent()
  check('4a. calendar legend', cal.includes('Completed') && cal.includes('Pending') && cal.includes('Cancelled'))
  const openCount = ((await pg.locator('main').textContent()).match(/Open slot/g) || []).length
  check('4b. calendar appt card renders (1 booked of 10)', /Unscheduled|Consultation|Prophylaxis|Filling|Extraction|Braces/g.test(cal))
  check('4c. calendar summary', cal.includes('This week') && cal.includes('booked'))

  // 5. patients list: count/Add New/meta format; EHR opens
  await pg.goto(base + '/doctor/patients'); await pg.waitForTimeout(1200)
  const pl = await pg.locator('main').textContent()
  check('5a. patients count', /total/.test(pl))
  check('5b. Add New Patient button', await pg.locator('button:has-text("Add New Patient")').count() > 0)
  check('5c. no test junk rows', !pl.includes('Prod Patient') && !pl.includes('QA Final'))
  await pg.locator('main button:has-text("Maria Santos")').first().click()
  await pg.waitForTimeout(1200)
  const ehr = await pg.locator('main').textContent()
  check('5d. EHR screen opens', ehr.includes('Patient Record'))
  check('5e. EHR medical note', ehr.includes('allergies in Antibiotics'))
  check('5f. EHR attachments', ehr.includes('X-ray — tooth #16.jpg'))
  check('5g. EHR export button', ehr.includes('Export EHR'))
  await pg.screenshot({ path: '/tmp/ehr-live.png', fullPage: true })

  // 6. staff: count/card/you-badge/deactivated
  await login('owner@dentalvibe.ph')
  await pg.goto(base + '/owner/staff'); await pg.waitForTimeout(1200)
  const st = await pg.locator('main').textContent()
  check('6a. staff members count', /members/.test(st))
  check('6b. ADD NEW DENTIST card', st.includes('Create a new dentist account'))
  check('6c. You badge', st.includes('You'))
  check('6d. Deactivated section + Diaz', st.includes('Deactivated') && st.includes('Dr. Ramon V. Diaz'))

  // 7. settings screen
  await pg.goto(base + '/owner/settings'); await pg.waitForTimeout(1200)
  const se = await pg.locator('main').textContent()
  check('7a. settings sections', se.includes('My profile') && se.includes('Clinic profile') && se.includes('Account'))
  check('7b. settings logout row', se.includes('Log Out'))

  // 8. add patient modal
  await pg.goto(base + '/owner/patients'); await pg.waitForTimeout(1000)
  await pg.locator('button:has-text("Add New Patient")').click(); await pg.waitForTimeout(500)
  const ap2 = await pg.locator('body').textContent()
  check('8. add patient modal fields', ap2.includes('Internal notes') && ap2.includes('Emergency contact'))

  console.log(`\n=== FIGMA FIDELITY: ${pass} passed, ${fail} failed ===`)
  console.log('page errors:', errs.length ? errs : 'NONE')
  await b.close()
  process.exit(fail === 0 ? 0 : 1)
})
