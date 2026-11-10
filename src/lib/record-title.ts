// The client prefix on a new ticket's or opportunity's title. A client's
// prefix is its existing Client.prefix field (set on the client forms,
// stored upper case, also used for asset tags). When a ticket or an
// opportunity is created for a client with a prefix, its title is saved as
// "<PREFIX> - <title>". The rule runs on the server, inside createTicket
// and createOpportunity, so every create path gets it (the dialogs, the
// API, an opportunity made when a quote is sent, and any later email
// path); the dialogs show the same result as a preview. Editing a title or
// changing a record's client later never touches it, and existing records
// are left as they are. No React and no database imports.

export const TITLE_PREFIX_SEPARATOR = " - "

// The title as it will be saved: trimmed, with "<PREFIX> - " in front when
// the client has a prefix and the title doesn't already start with it
// (ignoring case). Without a prefix, the title as typed (trimmed).
export function prefixedTitle(title: string, prefix: string | null | undefined): string {
  const text = title.trim()
  const p = (prefix ?? "").trim()
  if (!p) return text
  const head = `${p}${TITLE_PREFIX_SEPARATOR}`
  if (text.toLowerCase().startsWith(head.toLowerCase())) return text
  return `${head}${text}`
}

// ─── The length limit ───────────────────────────────────────────────────────
// A title's limit (200 for tickets and opportunities) counts the saved
// title, prefix included, so a typed title that fits on its own can still
// be too long once the client's prefix goes in front.

export function titleTooLongMessage(saved: string, max: number): string {
  const over = saved.length - max
  return `With the client prefix the title would be ${saved.length} characters, and titles can be up to ${max}. Shorten it by ${over} ${over === 1 ? "character" : "characters"}.`
}

// The saved title, or the refusal when it is longer than max
export function checkPrefixedTitle(
  title: string,
  prefix: string | null | undefined,
  max: number
): { value: string; error?: undefined } | { error: string; value?: undefined } {
  const saved = prefixedTitle(title, prefix)
  return saved.length > max ? { error: titleTooLongMessage(saved, max) } : { value: saved }
}

// For a title nobody typed (an opportunity made from a quote's title): the
// prefixed title, with the end of the original title cut so it fits
export function fitPrefixedTitle(title: string, prefix: string | null | undefined, max: number): string {
  const saved = prefixedTitle(title, prefix)
  if (saved.length <= max) return saved
  return saved.slice(0, max).trimEnd()
}
