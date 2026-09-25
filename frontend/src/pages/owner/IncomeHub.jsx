import useEscape from '../../lib/useEscape'
import { useSubmit , useRevalidateOnVisible } from '../../lib/hooks'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, peso } from '../../lib/api'
import { printReport } from '../../lib/format'
// ponytail: transactions ledger = walk-in/counter entries only; appointment income
// derives from paid appointments at query time (no FK by design — double-entry only if
// someone logs an appointment payment manually; the form hint below prevents that)

// Income hub with 3 segments (p65/111/118): Analytics · Transactions · Reports
const PERIODS = ['Monthly', 'Yearly', 'All time', 'Custom']
const PROCEDURES = ['Pasta (Restoration)', 'Extraction', 'Prophylaxis', 'Whitening', 'Consultation']
const EXP_CATS = ['Equipment', 'Supplies', 'Utilities', 'Rent', 'Salary', 'Other']

const short = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

export default function IncomeHub() {
  const navigate = useNavigate()
  const [seg, setSeg] = useState('Analytics')
  const [period, setPeriod] = useState('Monthly')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [txns, setTxns] = useState(null)
  const [appts, setAppts] = useState([])
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const load = () => {
    supabase.from('transactions').select('*').order('entry_date', { ascending: false })
      .then(({ data, error }) => (error ? setErr(error.message) : setTxns(data ?? [])))
    supabase.from('appointments').select('id, status, price, scheduled_at, services(name), patients(full_name)').eq('payment_status', 'paid').neq('status', 'cancelled')
      .then(({ data }) => setAppts(data ?? []))
  }
  useEffect(load, [])

  // income derives from `transactions` alone — settled payments auto-create ledger
  // rows (fn_apply_payment_result), so summing appointments too would double-count
  const income = useMemo(() => (txns ?? []).filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [txns])
  const expenses = useMemo(() => (txns ?? []).filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [txns])

  const inPeriod = (iso) => {
    const d = new Date(iso)
    const now = new Date()
    if (period === 'Custom') {
      if (from && d < new Date(from + 'T00:00:00')) return false
      if (to && d > new Date(to + 'T23:59:59')) return false
      return true
    }
    if (period === 'Monthly') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    if (period === 'Yearly') return d.getFullYear() === now.getFullYear()
    return true
  }
  const pIncome = useMemo(() => (txns ?? []).filter((t) => t.type === 'income' && inPeriod(t.entry_date)).reduce((s, t) => s + Number(t.amount), 0), [txns, period])
  const pExpenses = useMemo(() => (txns ?? []).filter((t) => t.type === 'expense' && inPeriod(t.entry_date)).reduce((s, t) => s + Number(t.amount), 0), [txns, period])
  const net = pIncome - pExpenses

  const byProc = useMemo(() => {
    const counts = {}
    appts.filter((a) => inPeriod(a.scheduled_at ?? a.requested_date)).forEach((a) => {
      const name = a.services?.name ?? 'Other'
      counts[name] = (counts[name] ?? 0) + Number(a.price ?? 0)
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [appts, period])

  const byExpCat = useMemo(() => {
    const counts = {}
    ;(txns ?? []).filter((t) => t.type === 'expense' && inPeriod(t.entry_date)).forEach((t) => {
      counts[t.category] = (counts[t.category] ?? 0) + Number(t.amount)
    })
    const tot = Object.values(counts).reduce((s, v) => s + v, 0) || 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, Math.round((v / tot) * 100)])
  }, [txns, period])

  const completedCount = appts.filter((a) => inPeriod(a.scheduled_at ?? a.requested_date)).length
  const patientCount = new Set(appts.map((a) => a.patients?.full_name)).size
  const avg = completedCount ? Math.round(pIncome / completedCount) : 0

  const exportReport = async (which) => {
    const clinic = await clinicName()
    const lines = [
      clinic + ` — ${which} Report`, `Generated: ${new Date().toLocaleString()}`, `Period: ${period}`,
      '', `Total income: ${peso(pIncome)}`, `Total expenses: ${peso(pExpenses)}`, `Net income: ${peso(net)}`,
      `Completed visits: ${completedCount}`, `Average per visit: ${peso(avg)}`, '',
      'By procedure:', ...byProc.map(([n, v]) => `  ${n}: ${peso(v)}`), '',
      'Expenses by category:', ...byExpCat.map(([n, v, pct]) => `  ${n}: ${peso(v)} (${pct}%)`),
    ]
    printReport(clinic + ` — ${which} Report`, lines)
  }

  const maxProc = Math.max(1, ...byProc.map(([, v]) => v))

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Income Analytics</h1>
        <div className="flex gap-2">
          <button aria-label="Export report" onClick={() => exportReport(period)} aria-label="Export report"
                  className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>
          </button>
          <button onClick={() => setAdding((v) => !v)} className="h-9 px-3.5 rounded-lg bg-primary-600 text-white text-xs font-semibold">
            {adding ? 'Close' : '+ Add Transaction'}
          </button>
        </div>
      </div>

      {/* segment tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        {['Analytics', 'Transactions', 'Reports'].map((s) => (
          <button key={s} onClick={() => setSeg(s)}
                  className={'flex-1 h-11 rounded-md text-xs font-semibold ' + (seg === s ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500')}>{s}</button>
        ))}
      </div>

      {adding && <AddTransaction onDone={() => { setAdding(false); load() }} />}

      {err && <p className="text-xs text-red-500">{err}</p>}

      {/* ---------- ANALYTICS ---------- */}
      {seg === 'Analytics' && <>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
                    className={'h-11 px-3.5 rounded-full text-xs font-semibold ' + (period === p ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-white text-gray-500 border border-gray-200')}>{p}</button>
          ))}
        </div>
        {period === 'Custom' && (
          <div className="flex gap-2 items-center text-xs">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="h-9 px-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold" />
            <span className="text-gray-500">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="h-9 px-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold" />
          </div>
        )}
        <p className="text-[11px] text-gray-500 text-center">{period} totals</p>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Net income</div>
          <div className={"text-3xl font-bold mt-1 " + (net < 0 ? "text-red-600" : "text-gray-900")}>{net < 0 ? "−" + peso(Math.abs(net)) : peso(net)}</div>
          <div className="flex justify-between text-xs mt-3 pt-3 border-t border-gray-100">
            <span className="text-green-600 font-semibold">+{peso(pIncome)} income</span>
            <span className="text-red-500 font-semibold">−{peso(pExpenses)} expenses</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3.5">
            <div className="text-lg font-bold text-gray-900">{patientCount}</div>
            <div className="text-[11px] text-gray-500">patients served</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3.5">
            <div className="text-lg font-bold text-gray-900">{peso(avg)}</div>
            <div className="text-[11px] text-gray-500">avg per completed visit</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-bold text-gray-900">Revenue by procedure</div>
            <div className="text-[11px] text-gray-500">{period}</div>
          </div>
          {byProc.length === 0 && <p className="text-xs text-gray-500 py-2">No completed visits in this period.</p>}
          {byProc.map(([name, v]) => (
            <div key={name} className="mb-2.5 last:mb-0">
              <div className="flex justify-between text-xs mb-1"><span className="text-gray-700 font-medium">{name}</span><span className="font-bold text-gray-900">{peso(v)}</span></div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full" style={{ width: `${(v / maxProc) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-bold text-gray-900 mb-3">Expenses by category</div>
          {byExpCat.length === 0 && <p className="text-xs text-gray-500">No expenses recorded in this period.</p>}
          {byExpCat.map(([name, v, pct]) => (
            <div key={name} className="flex justify-between text-xs py-1.5 border-t border-gray-50">
              <span className="text-gray-700">{name}</span>
              <span className="font-bold text-gray-900">{peso(v)} <span className="text-gray-500 font-medium">· {pct}%</span></span>
            </div>
          ))}
        </div>
      </>}

      {/* ---------- TRANSACTIONS ---------- */}
      {seg === 'Transactions' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Income This Month</div>
              <div className="text-xl font-bold text-gray-900">{peso(pIncome)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Expenses This Month</div>
              <div className="text-xl font-bold text-red-500">{peso(pExpenses)}</div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {(txns ?? []).length === 0 && <div className="px-3.5 py-4 text-sm text-gray-500">No transactions recorded.</div>}
            {(txns ?? []).map((t) => (
              <div key={t.id} className="flex justify-between items-center px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{t.category}</div>
                  <div className="text-xs text-gray-500">{short(new Date(t.entry_date))}{t.patient_name ? ` · ${t.patient_name}` : ''}{t.description ? ` · ${t.description}` : ''}</div>
                </div>
                <div className={'text-sm font-bold ' + (t.type === 'income' ? 'text-green-600' : 'text-red-500')}>
                  {t.type === 'income' ? '+' : '−'}{peso(t.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- REPORTS ---------- */}
      {seg === 'Reports' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Total Income</div>
              <div className="text-xl font-bold text-gray-900">{peso(pIncome)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Net Income</div>
              <div className="text-xl font-bold text-primary-700">{peso(net)}</div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">Report contents</div>
            {[
              ['Net income', peso(net)], ['Total income', peso(pIncome)], ['Total expenses', peso(pExpenses)],
              ['Completed visits', completedCount], ['Average per visit', peso(avg)], ['Period', period],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-1.5 border-t border-gray-50">
                <span className="text-gray-600">{k}</span><span className="font-bold text-gray-900">{v}</span>
              </div>
            ))}
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Generate</div>
            <button onClick={() => exportReport('Monthly')} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">⬇ Export Monthly Report</button>
            <button onClick={() => exportReport('Annual')} className="w-full h-11 rounded-lg border border-gray-200 text-gray-800 text-sm font-semibold bg-white">⬇ Export Annual Report</button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddTransaction({ onDone }) {
  const [type, setType] = useState('income')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [patient, setPatient] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const cats = type === 'income'
    ? ['Pasta (Restoration)', 'Extraction', 'Prophylaxis', 'Whitening', 'Consultation', 'Other']
    : EXP_CATS

  const saveImpl = async (e) => {
    e.preventDefault()
    setErr('')
    const amt = Number(amount)
    if (!amt || amt <= 0) return setErr('Enter a valid amount.')
    if (!category) return setErr('Pick a category.')
    setBusy(true)
    const { error } = await supabase.from('transactions').insert({
      type, category, amount: amt, patient_name: patient || null, description: desc || null, entry_date: date,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
  }
  const [save, incBusy] = useSubmit(saveImpl)

  return (
    <form onSubmit={save} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3.5">
      <div className="text-sm font-bold text-gray-900">Add Transaction</div>
      <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₱"
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <div className="flex bg-gray-100 rounded-lg p-1">
        {['income', 'expense'].map((t) => (
          <button key={t} type="button" onClick={() => { setType(t); setCategory('') }}
                  className={'flex-1 h-11 rounded-md text-xs font-semibold capitalize ' + (type === t ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500')}>{t}</button>
        ))}
      </div>
      <div>
        <div className="text-xs font-medium text-gray-500 mb-1.5">Category {type}</div>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)}
                    className={'h-11 px-3 rounded-full text-xs font-semibold border ' + (category === c ? 'bg-primary-50 text-primary-700 border-primary-300' : 'bg-white text-gray-600 border-gray-200')}>{c}</button>
          ))}
        </div>
      </div>
      {type === 'income' && (
        <input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="Patient (optional)"
               className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      )}
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={type === 'income' ? 'Notes (optional)' : 'What was this expense for?'}
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2.5">
        <button type="button" onClick={onDone} className="flex-1 h-10 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold bg-white">Cancel</button>
        <button disabled={busy} className="flex-1 h-10 rounded-lg bg-primary-600 text-white text-xs font-semibold disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}
