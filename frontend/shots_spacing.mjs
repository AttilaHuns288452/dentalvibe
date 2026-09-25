// Before/after spacing screenshots. usage: node shots_spacing.mjs
import { chromium } from './qa_playwright.mjs'
import fs from 'fs'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:4176'
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url))
fs.mkdirSync(OUT, { recursive: true })

const b = await chromium.launch()
const VPS = [[360, 800], [390, 844]]

async function shoot(name, pg, path) {
  await pg.goto(BASE + path, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(700)
  for (const [w, h] of VPS) {
    await pg.setViewportSize({ width: w, height: h })
    await pg.waitForTimeout(300)
    await pg.screenshot({ path: `${OUT}/${name}_${w}x${h}.png`, fullPage: true })
  }
}

// login (signin)
{
  const ctx = await b.newContext()
  const pg = await ctx.newPage()
  await shoot('login_signin_before', pg, '/')
  await ctx.close()
}
// login (signup)
{
  const ctx = await b.newContext()
  const pg = await ctx.newPage()
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.locator('button:has-text("Register")').click()
  await pg.waitForTimeout(500)
  for (const [w, h] of VPS) {
    await pg.setViewportSize({ width: w, height: h })
    await pg.waitForTimeout(300)
    await pg.screenshot({ path: `${OUT}/login_signup_before_${w}x${h}.png`, fullPage: true })
  }
  await ctx.close()
}
// reset password
{
  const ctx = await b.newContext()
  const pg = await ctx.newPage()
  await shoot('reset_pw_before', pg, '/reset')
  await ctx.close()
}

await b.close()
console.log('before shots saved')
