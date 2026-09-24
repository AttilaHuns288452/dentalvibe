import { useEffect, useState } from 'react'
import { listAppointments, peso, supabase } from '../../lib/api'

// Income: completed appointments (price locked at booking) − real expenses.

export default function OwnerIncome() {
  const [appts, setAppts] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    listAppointments().then(setAppts).catch((e) => setErr(e.message))
    loadExpenses()
  }, [])

  const loadExpenses = () =>
    supabase.from('expenses').select('*').order('spent_on', { ascending: false })
      .then(({ data, error }) => (error ? setErr(error.message) : setExpenses(data ?? [])))

  const addExpense = async (e) => {
    e.preventDefault()
    if (!name.trim() || !Number(amount)) return
    const { error } = await supabase.from('expenses').insert({ name: name.trim(), amount: Number(amount) })
    if (error) return setErr(error.message)
    setName(''); setAmount(''); setAdding(false)
    loadExpenses()
  }

  const removeExpense = async (id) => {
    await supabase.from('expenses').delete().eq('id', id)
    loadExpenses()
  }

  const completed = (appts ?? []).filter((a) => a.status === 'completed')
  const income = completed.reduce((sum, a) => sum + Number(a.price ?? a.services?.price ?? 0), 0)
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Income</h1>
        <p className="text-xs text-gray-500">Completed appointments · net of expenses</p>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Net income</div>
        <div className="text-3xl font-bold text-gray-900 mt-1">{peso(income - expensesTotal)}</div>
        <div className="flex justify-between text-xs mt-3 pt-3 border-t border-gray-100">
          <span className="text-green-600 font-semibold">+{peso(income)} income</span>
          <span className="text-red-500 font-semibold">−{peso(expensesTotal)} expenses</span>
        </div>
      </div>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Transactions ({completed.length})</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {completed.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No completed appointments yet.</div>}
          {completed.map((a) => (
            <div key={a.id} className="flex justify-between items-center px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{a.patients?.full_name}</div>
                <div className="text-xs text-gray-500">
                  {a.services?.name}
                  {Number(a.price ?? a.services?.price) !== Number(a.services?.price) ? ' · custom price' : ''}
                  {a.scheduled_at ? ` · ${new Date(a.scheduled_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
                </div>
              </div>
              <div className="text-sm font-bold text-gray-900">{peso(a.price ?? a.services?.price)}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Expenses</h2>
          <button onClick={() => setAdding((v) => !v)} className="text-xs font-semibold text-primary-700">{adding ? 'Close' : '+ Add'}</button>
        </div>
        {adding && (
          <form onSubmit={addExpense} className="bg-primary-50 border border-primary-100 rounded-lg p-3.5 space-y-2.5 mb-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Expense name"
                   className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₱"
                   className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
            <button className="w-full h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold">Add Expense</button>
          </form>
        )}
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {expenses.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No expenses recorded.</div>}
          {expenses.map((e) => (
            <div key={e.id} className="flex justify-between items-center px-3.5 py-2.5 text-sm">
              <span className="text-gray-700">{e.name} <span className="text-gray-500">· {new Date(e.spent_on).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-red-500">−{peso(e.amount)}</span>
                <button onClick={() => removeExpense(e.id)} aria-label="Delete expense" className="text-gray-300 hover:text-red-400">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
