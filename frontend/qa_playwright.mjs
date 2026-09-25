// ponytail: bare 'playwright' if installed, hermes-agent copy as fallback
let pw
try { pw = await import('playwright') }
catch { pw = await import('/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs') }
export const { chromium } = pw
