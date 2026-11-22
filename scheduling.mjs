/* Weekly availability and bookable time slots. Times are local Estonian time (Europe/Tallinn),
   written as "HH:MM"; dates as "YYYY-MM-DD". Pure functions, so they're easy to test. */

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const TIME_ZONE = 'Europe/Tallinn';
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toMinutes = t => (TIME_RE.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : NaN);
export const toTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const isDate = s => DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);

/* Clean a weekly schedule from user input: known days only, valid "HH:MM" windows with
   start < end, at most 4 windows per day, sorted and with overlapping windows merged. */
export function cleanWeekly(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const day of WEEKDAYS) {
    const windows = (Array.isArray(input[day]) ? input[day] : [])
      .map(w => ({ s: toMinutes(String(w?.start || '')), e: toMinutes(String(w?.end || '')) }))
      .filter(w => Number.isFinite(w.s) && Number.isFinite(w.e) && w.s < w.e)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const w of windows) {
      const last = merged[merged.length - 1];
      if (last && w.s <= last.e) last.e = Math.max(last.e, w.e); else merged.push({ ...w });
    }
    if (merged.length) out[day] = merged.slice(0, 4).map(w => ({ start: toTime(w.s), end: toTime(w.e) }));
  }
  return out;
}

// Today's date and the minutes since midnight in Estonia.
export function localNow(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const weekdayOf = date => WEEKDAYS[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7];
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/* Bookable start times for one date.
   busy: existing active bookings on that date as [{ start: "HH:MM", end: "HH:MM" }].
   Returns { slots: [{ start, end }], reason } — reason explains an empty list. */
export function generateSlots({ weekly, slotMinutes, durationMinutes, date, busy = [], urgent = false, now = localNow(), leadMinutes = 60, maxDaysAhead = 90 }) {
  if (!isDate(date)) return { slots: [], reason: 'invalid-date' };
  const ahead = daysBetween(now.date, date);
  if (ahead < 0) return { slots: [], reason: 'past' };
  if (ahead > maxDaysAhead) return { slots: [], reason: 'too-far' };
  if (ahead === 0 && !urgent) return { slots: [], reason: 'no-same-day' };
  const step = Math.max(15, slotMinutes || 60), duration = Math.max(step, durationMinutes || step);
  const taken = busy.map(b => ({ s: toMinutes(b.start), e: toMinutes(b.end) })).filter(b => Number.isFinite(b.s));
  const slots = [];
  for (const w of weekly?.[weekdayOf(date)] || []) {
    const ws = toMinutes(w.start), we = toMinutes(w.end);
    for (let s = ws; s + duration <= we; s += step) {
      if (ahead === 0 && s < now.minutes + leadMinutes) continue;
      if (taken.some(b => s < b.e && s + duration > b.s)) continue;
      slots.push({ start: toTime(s), end: toTime(s + duration) });
    }
  }
  return { slots, reason: slots.length ? null : (weekly?.[weekdayOf(date)]?.length ? 'fully-booked' : 'day-off') };
}

// Durations a client can pick: hourly work in multiples of the slot (up to 8 hours or 4 slots,
// whichever is longer); packages and events take exactly one slot.
export function durationOptions(pricingType, slotMinutes) {
  const step = Math.max(15, slotMinutes || 60);
  if (pricingType !== 'HOURLY') return [step];
  const out = [];
  for (let m = step; m <= Math.max(step * 4, 480) && out.length < 8; m += step) out.push(m);
  return out;
}

export const priceFor = (pricingType, priceAmount, durationMinutes) =>
  Math.round((pricingType === 'HOURLY' ? Number(priceAmount) * durationMinutes / 60 : Number(priceAmount)) * 100) / 100;
