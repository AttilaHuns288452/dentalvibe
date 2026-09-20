import { useEffect, useState } from 'react'
import { listAppointments, peso } from '../../lib/api'

// Income: completed appointments = income. Net = income − mock expenses for now.

const MOCK_EXPENSES = [
  { name: 'Sterilizer upgrade', amount: 8500, date: 'Aug 12' },
  { name: 'Dental materials', amount: 4200, date: 'Aug 08' },
]

export default function OwnerIncome() {
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    listAppointments().then(setAppts).catch((e) => setErr(e.message))
  }, [])

  const completed = (appts ?? []).filter((a) => a.status === 'completed')
  // price was locked in per-appointment at booking time (custom exceptions included)
  const income = completed.reduce((sum, a) => sum + Number(a.price ?? a.services?.price ?? 0), 0)
  const expenses = MOCK_EXPENSES.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Income</h1>
        <p className="text-xs text-gray-500">Completed appointments · net of expenses</p>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Net income</div>
        <div className="text-3xl font-bold text-gray-900 mt-1">{peso(income - expenses)}</div>
        <div className="flex justify-between text-xs mt-3 pt-3 border-t border-gray-100">
          <span className="text-green-600 font-semibold">+{peso(income)} income</span>
          <span className="text-red-500 font-semibold">−{peso(expenses)} expenses</span>
        </div>
      </div>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Transactions ({completed.length})</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {completed.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-400">No completed appointments yet.</div>}
          {completed.map((a) => (
            <div key={a.id} className="flex justify-between items-center px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{a.patients?.full_name}</div>
                <div className="text-xs text-gray-500">{a.services?.name}{Number(a.price ?? a.services?.price) !== Number(a.services?.price) ? ' (custom price)' : ''}</div>
              </div>
              <div className="text-sm font-bold text-gray-900">{peso(a.price ?? a.services?.price)}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Expenses</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {MOCK_EXPENSES.map((e) => (
            <div key={e.name} className="flex justify-between px-3.5 py-2.5 text-sm">
              <span className="text-gray-700">{e.name} <span className="text-gray-400">· {e.date}</span></span>
              <span className="font-bold text-red-500">−{peso(e.amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
