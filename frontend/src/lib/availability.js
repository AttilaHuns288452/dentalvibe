// One authoritative availability model — clinic hours come from clinic_settings; nothing else
// may hardcode open days, hours, or slot lists.
// Timezone: Asia/Manila. All wall-clock conversion goes through Intl.DateTimeFormat —
// never (getUTCHours() + 8) arithmetic.

export const TZ = 'Asia/Manila'
const minsOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// Manila wall-clock parts for an instant ('YYYY-MM-DD' day key + 'HH:MM')
const manilaParts = (date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]),
)

// Manila calendar day key ('YYYY-MM-DD') for an instant
export const manilaDayKey = (date) => {
  const p = manilaParts(date)
  return `${p.year}-${p.month}-${p.day}`
}

// Manila wall-clock 'HH:MM' for an instant
export const manilaHM = (date) => {
  const p = manilaParts(date)
  return `${p.hour}:${p.minute}`
}

// Date-key arithmetic (pure calendar, no clock) — noon-UTC anchor keeps the day stable.
export const addDaysISO = (dateISO, n) => {
  const d = new Date(`${dateISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Manila wall time ('YYYY-MM-DD' + 'HH:MM') → Date instant. Asia/Manila is fixed
// UTC+8 (PH has no DST), so the offset suffix is exact.
export const manilaToInstant = (dateISO, hhmm) => new Date(`${dateISO}T${hhmm}:00+08:00`)

// Is the clinic open on calendar date `dateISO` ('YYYY-MM-DD')? Driven by settings.open_days
// ({Mon,Tue,...}). Noon-UTC anchor keeps the Manila weekday stable (PH has no DST).
export function isOpenOn(settings, dateISO) {
  if (!settings?.open_time || !settings.close_time || !settings.open_days?.length) return false
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
    .format(new Date(`${dateISO}T12:00:00Z`))
  return settings.open_days.includes(weekday)
}

// 30-minute-interval start times 'HH:MM' on dateISO where a visit of durationMinutes fits
// entirely before close and does not overlap any busyRange ({start: Date, mins}).
// ponytail: minutes-of-day overlap math assumes busy ranges stay within one Manila day —
// true while slots can only be booked inside open hours.
export function slotStartsFor({ open_time, close_time, open_days }, dateISO, durationMinutes = 30, busyRanges = []) {
  if (!isOpenOn({ open_time, close_time, open_days }, dateISO)) return []
  const openM = minsOf(open_time)
  const closeM = minsOf(close_time)
  const busy = busyRanges
    .filter((b) => b?.start instanceof Date)
    .map((b) => {
      const p = manilaParts(b.start)
      return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), mins: b.mins ?? 30 }
    })
    .filter((b) => b.day === dateISO)
  const out = []
  for (let m = openM; m + durationMinutes <= closeM; m += 30) {
    const clash = busy.some((b) => m < b.min + b.mins && b.min < m + durationMinutes)
    if (!clash) out.push(hhmm(m))
  }
  return out
}

// Capacity-aware variant (multi-dentist): perDentistBusy is one busyRanges list per
// available dentist. A start is offered when AT LEAST ONE dentist is free for the
// whole visit — parallel chairs may overlap each other, never themselves.
// Empty perDentistBusy (zero available dentists) ⇒ no slots.
export function slotStartsForDentists(settings, dateISO, durationMinutes = 30, perDentistBusy = []) {
  const ok = new Set()
  for (const busy of perDentistBusy) {
    for (const t of slotStartsFor(settings, dateISO, durationMinutes, busy)) ok.add(t)
  }
  return [...ok].sort()
}
