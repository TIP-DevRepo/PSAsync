// Email address checks shared by every send dialog and route (Send Quote,
// the Email action on records). No React and no database imports, so the
// browser can use them too.

const EMAIL_PATTERN = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value)
}

// A comma separated recipient list from the Send Quote dialog, trimmed and
// checked. Returns the cleaned list, or an error naming the bad address.
export function parseRecipients(
  value: unknown
): { list: string[]; error?: undefined } | { error: string; list?: undefined } {
  if (value === undefined || value === null || value === "") return { list: [] }
  if (typeof value !== "string") return { error: "Recipients must be a list of email addresses" }
  const list = value
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
  const bad = list.find((e) => !isEmailAddress(e))
  if (bad) return { error: `"${bad}" is not a valid email address` }
  return { list }
}
