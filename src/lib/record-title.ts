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
