// Shared helpers for anything that builds an HTML string by hand: the quote
// PDF (rendered server side by Puppeteer) and notification emails. Every
// value that came from a user, a client, or the database goes through one
// of these before it lands in markup.

// Safe for both element text and quoted attribute values
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Plain text with line breaks kept, for message bodies in emails
export function escapeHtmlWithBreaks(value: string | null | undefined): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br/>")
}

// What Company Settings accepts on save: #rgb or #rrggbb
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

// For rendering a stored brand color into CSS. Also allows the 4 and 8
// digit forms CompanyThemeProvider already accepts, so any color that
// renders in the app renders the same here. Anything else falls back.
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  return value && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? value : fallback
}

// An http(s) URL escaped for a quoted attribute, or null for anything else
// (javascript:, data:, file:, malformed values)
export function safeUrlAttr(value: string | null | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null
  return escapeHtml(value)
}
