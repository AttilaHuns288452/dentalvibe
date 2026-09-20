import { createClient } from '@supabase/supabase-js'

// ponytail: publishable key is public by design; RLS policies guard the tables
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
