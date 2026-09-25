import { createClient } from '@supabase/supabase-js'

// ponytail: publishable key is public by design; RLS policies guard the tables
// Sessions are PER TAB (sessionStorage): logging in on one tab can never flip
// another tab's account, and refresh keeps your own account. A duplicated tab
// clones its SOURCE tab's session — never another account's.
// Tradeoff: closing the tab forgets the login.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
