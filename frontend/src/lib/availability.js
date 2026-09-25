// One authoritative availability model — clinic hours come from clinic_settings; nothing else
// may hardcode open days, hours, or slot lists.
// Timezone: Asia/Manila. All wall-clock conversion goes through Intl.DateTimeFormat —
// never (getUTCHours() + 8) arithmetic.

const TZ = 'Asia/Manila'
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
