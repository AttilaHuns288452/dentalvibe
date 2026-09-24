// THE demo-data map. Single source of truth consumed by seed.mjs (creates) and cleanup.mjs (protects).
// Identity key per appointment = date | patient | service | status — never mass-delete rows that match it.
export const PATIENTS = [
  ['Maria Santos', 'maria@dentalvibe.ph', '+63 917 555 0101'],
  ['Juan Dela Cruz', 'juan@dentalvibe.ph', '+63 917 555 0102'],
  ['Andrea Reyes', 'andrea@dentalvibe.ph', '+63 917 555 0103'],
  ['Liza Mendoza', 'liza@dentalvibe.ph', '+63 917 555 0104'],
  ['Carlo Bautista', 'carlo@dentalvibe.ph', '+63 917 555 0105'],
]

export const SEED_SERVICES = ['Consultation', 'Oral Prophylaxis', 'Tooth Filling', 'Tooth Extraction', 'Braces Consultation', 'Fluoride Treatment', 'Whitening']

export const SEED_APPTS = [
  ['Carlo Bautista', 'Braces Consultation', 'cancelled', '2026-09-01', 'Rescheduled'],
  ['Andrea Reyes', 'Oral Prophylaxis', 'completed', '2026-09-02', ''],
  ['Liza Mendoza', 'Braces Consultation', 'completed', '2026-09-07', ''],
  ['Juan Dela Cruz', 'Oral Prophylaxis', 'completed', '2026-09-08', 'For cleaning po'],
  ['Maria Santos', 'Tooth Extraction', 'completed', '2026-09-12', 'Wisdom tooth'],
  ['Carlo Bautista', 'Tooth Filling', 'completed', '2026-09-15', ''],
  ['Juan Dela Cruz', 'Tooth Filling', 'completed', '2026-09-22', 'Sensitivity on upper right'],
  ['Maria Santos', 'Oral Prophylaxis', 'completed', '2026-09-22', ''],
  ['Maria Santos', 'Braces Consultation', 'completed', '2026-09-23', 'Adjustment visit'],
  ['Maria Santos', 'Braces Consultation', 'pending', '2026-09-24', 'Follow-up po'],
  ['Juan Dela Cruz', 'Oral Prophylaxis', 'completed', '2026-09-24', ''],
  ['Andrea Reyes', 'Tooth Extraction', 'pending', '2026-10-05', 'For cleaning po'],
  ['Liza Mendoza', 'Braces Consultation', 'pending', '2026-10-06', 'Wisdom tooth hurts'],
  ['Carlo Bautista', 'Fluoride Treatment', 'approved', '2026-10-07', ''],
  ['Andrea Reyes', 'Braces Consultation', 'pending', '2026-10-08', ''],
  ['Maria Santos', 'Tooth Filling', 'approved', '2026-10-09', 'Routine checkup'],
  ['Maria Santos', 'Braces Consultation', 'pending', '2026-10-26', ''],
]

export const EXCEPTIONS = [['Juan Dela Cruz', 'Oral Prophylaxis', 1000], ['Juan Dela Cruz', 'Tooth Filling', 1000], ['Andrea Reyes', 'Tooth Extraction', 1200]]

export const CHATS = [
  ['Maria Santos', 'patient', 'Good morning doc! Confirmation po ng checkup bukas?'],
  ['Maria Santos', 'clinic', 'Confirmed, Maria! 9:00 AM po. See you 👋'],
  ['Juan Dela Cruz', 'patient', 'Doc magkano po ang pasta?'],
  ['Juan Dela Cruz', 'clinic', '₱1,200 po sa filling. May promo kayo ng prophylaxis this month!'],
]

export const apptKey = (date, patient, service, status) => `${date}|${patient}|${service}|${status}`
