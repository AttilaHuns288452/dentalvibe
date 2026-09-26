import { supabase } from './api'

// Finance corrections + audit access (migrations 0022/0024).
// Mutations go through owner-only RPCs (fn_correct_transaction / fn_void_transaction);
// voided rows stay visible (struck) but must be excluded from totals by callers.

export async function correctTransaction(txId, newAmount, reason) {
  const { error } = await supabase.rpc('fn_correct_transaction', {
    p_tx: txId, p_new_amount: newAmount, p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

export async function voidTransaction(txId, reason) {
  const { error } = await supabase.rpc('fn_void_transaction', { p_tx: txId, p_reason: reason })
  if (error) throw new Error(error.message)
}

// all rows including voided (UI shows voided struck, skips them when summing)
export async function listTransactions() {
  const { data, error } = await supabase.from('transactions').select('*').order('entry_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// newest-first audit rows; filters: { action, entity, actor } — actor matches
// the resolved actor name/role client-side (audit_log has no FK to profiles).
export async function listAudit(filters = {}) {
  let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200)
  if (filters.action) q = q.eq('action', filters.action)
  if (filters.entity) q = q.eq('entity', filters.entity)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))]
  const names = {}
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
    for (const p of profs ?? []) names[p.id] = p.full_name
  }
  let out = rows.map((r) => ({
    ...r,
    actor_name: r.actor_id ? (names[r.actor_id] || 'User ' + String(r.actor_id).slice(0, 8)) : 'System',
  }))
  if (filters.actor) {
    const s = String(filters.actor).toLowerCase()
    out = out.filter((r) => `${r.actor_name} ${r.actor_role ?? ''}`.toLowerCase().includes(s))
  }
  return out
}
