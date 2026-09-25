// Portable QA module resolver — the single place suites get tooling from.
// playwright + @supabase/supabase-js are frontend dependencies: `npm install` in
// frontend/ is the whole setup, no machine-specific paths anywhere.
// createClient is re-exported so repo-root suites (live_demo.mjs) can resolve
// @supabase through frontend/node_modules — repo root has no package.json.
export const { chromium } = await import('playwright')
export { createClient } from '@supabase/supabase-js'
