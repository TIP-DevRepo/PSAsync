// Formats digits into (000) 000-0000 as far as the input goes, so it works
// both for live-as-you-type onChange handlers (partial digit counts) and
// for formatting an already-complete stored number. Non-numeric characters
// are stripped and anything past 10 digits is dropped, since this is a US
// phone format only.
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10)
  const len = digits.length
  if (len === 0) return ""
  if (len < 4) return `(${digits}`
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// For read-only display spots that currently fall back to an em-dash-style
// placeholder when the value is empty.
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return "—"
  return formatPhoneInput(value)
}
