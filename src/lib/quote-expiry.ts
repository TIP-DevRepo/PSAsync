// When a quote's expiry date has passed, and how its "Valid until" date
// reads. No server imports, so the portal page and the quote pages can use
// it as well as src/lib/portal-access.ts.
//
// The quote forms send a date (YYYY-MM-DD), which is stored as midnight UTC.
// Such a date means "valid through that calendar day", so it expires at the
// end of that day in PORTAL_EXPIRY_TIME_ZONE. An expiresAt with a real time
// of day is compared as is. No date, no expiry.

// Temporary stand in until companies have their own time zone setting
export const PORTAL_EXPIRY_TIME_ZONE = "America/New_York"

// A date picked from a date input: exactly 00:00:00.000 UTC
export function isDateOnly(date: Date): boolean {
  return (
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
  )
}

// How far the zone's wall clock is ahead of UTC at an instant, in ms
// (negative west of UTC), from Intl so daylight saving time is handled
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return wall - (instant - (instant % 1000))
}

// The instant the zone's clock reads 00:00 on the given calendar date.
// Checked twice so a date whose midnight falls on the other side of a
// daylight saving change still lands exactly.
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day)
  let instant = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone)
  instant = wallAsUtc - zoneOffsetMs(instant, timeZone)
  return new Date(instant)
}

// The moment the quote stops being valid: the end of the chosen day in
// PORTAL_EXPIRY_TIME_ZONE for a date only value, otherwise expiresAt itself
export function expiryInstant(expiresAt: Date): Date {
  if (!isDateOnly(expiresAt)) return expiresAt
  return zonedMidnight(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, expiresAt.getUTCDate() + 1, PORTAL_EXPIRY_TIME_ZONE)
}

// Expired from the end of the "Valid until" day (or the exact time, when
// one was stored). Null never expires.
export function isPastExpiry(expiresAt: Date | null, now: Date): boolean {
  return !!expiresAt && expiryInstant(expiresAt).getTime() <= now.getTime()
}

// Used when nothing else gives a quote's expiry days
export const DEFAULT_QUOTE_EXPIRY_DAYS = 30

// The company Default Expiry (days) setting: a whole number, 1 or more.
// Shared by the Quote Settings panel and its API route.
export const EXPIRY_DAYS_MESSAGE = "Default expiry must be a whole number of days, 1 or more"

export function isValidExpiryDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1
}

// The panel's field as typed: the days to save, or null when it is blank or
// anything but a whole number of 1 or more
export function parseExpiryDaysInput(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const days = Number(trimmed)
  return isValidExpiryDays(days) ? days : null
}

// A new quote's expiry date `days` days from today, as a date only value
// the way the New Quote form's date input stores it, so it is valid through
// that calendar day. "Today" is the date in PORTAL_EXPIRY_TIME_ZONE.
export function expiryDateFromToday(days: number, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_EXPIRY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + days))
}

// The "Valid until" date as the user chose it. A date only value is shown
// as that calendar date, not shifted a day back in time zones west of UTC.
export function formatValidUntil(expiresAt: Date | string | null | undefined, empty = ""): string {
  if (!expiresAt) return empty
  const date = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt
  if (Number.isNaN(date.getTime())) return empty
  return isDateOnly(date) ? date.toLocaleDateString(undefined, { timeZone: "UTC" }) : date.toLocaleDateString()
}
