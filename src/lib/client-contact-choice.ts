// The rules of a client and contact pair picked with ClientContactPicker
// (src/components/ClientContactPicker.tsx): a contact always belongs to the
// chosen client, so picking a contact also picks its client, and changing
// the client clears a contact it doesn't own. No React and no database
// imports, so each rule can be checked on its own.

export interface ChosenClient {
  id: string
  name: string
}

export interface ChosenContact {
  id: string
  name: string
  clientId: string
}

export interface ClientContactValue {
  client: ChosenClient | null
  contact: ChosenContact | null
}

// A contact as the search lists it: from GET /api/contacts/search, or one of
// the chosen client's own contacts with that client filled in
export interface ContactMatch {
  id: string
  firstName: string
  lastName: string
  title?: string | null
  email?: string | null
  client: { id: string; name: string }
}

export const contactFullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim()

// Picking a contact sets the client to the contact's own
export function chooseContact(match: ContactMatch): ClientContactValue {
  return {
    client: { id: match.client.id, name: match.client.name },
    contact: { id: match.id, name: contactFullName(match), clientId: match.client.id },
  }
}

// A new client keeps the contact only when that client owns it
export function chooseClient(value: ClientContactValue, client: ChosenClient | null): ClientContactValue {
  const keep = !!client && !!value.contact && value.contact.clientId === client.id
  return { client, contact: keep ? value.contact : null }
}

// The chosen client's contacts first, then everyone else's, each group in
// the order given, every contact once
export function orderContactMatches<T extends { id: string; client: { id: string } }>(matches: readonly T[], preferredClientId: string | null | undefined): T[] {
  const seen = new Set<string>()
  const unique = matches.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  if (!preferredClientId) return unique
  return [...unique.filter((m) => m.client.id === preferredClientId), ...unique.filter((m) => m.client.id !== preferredClientId)]
}

// The chosen client's contacts that match typed text by name, email, or
// title, the way the contact search route matches
export function matchesContactQuery(c: { firstName: string; lastName: string; email?: string | null; title?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.firstName, c.lastName, contactFullName(c), c.email ?? "", c.title ?? ""].some((v) => v.toLowerCase().includes(q))
}
