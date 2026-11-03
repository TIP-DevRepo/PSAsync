// Links into a client page: its default tab, or its Contacts or Locations
// tab with one row scrolled into view and highlighted briefly. Any new link
// to a client's contact or location uses these. No React and no database
// imports.

import { TAB_PARAM } from "@/lib/tab-url"

export const CLIENT_CONTACT_PARAM = "contact"
export const CLIENT_LOCATION_PARAM = "location"

const base = (clientId: string) => `/dashboard/clients/${encodeURIComponent(clientId)}`

export function clientPageHref(clientId: string): string {
  return base(clientId)
}

export function clientContactHref(clientId: string, contactId: string): string {
  const params = new URLSearchParams({ [TAB_PARAM]: "contacts", [CLIENT_CONTACT_PARAM]: contactId })
  return `${base(clientId)}?${params}`
}

export function clientLocationHref(clientId: string, locationId: string): string {
  const params = new URLSearchParams({ [TAB_PARAM]: "locations", [CLIENT_LOCATION_PARAM]: locationId })
  return `${base(clientId)}?${params}`
}

export interface ClientHighlight {
  kind: "contact" | "location"
  id: string
}

// The row the URL asks to highlight: ?contact= on the Contacts tab, or
// ?location= on the Locations tab, only when that id is one of this
// client's rows. Anything else (another tab, an unknown or another client's
// id) is quietly ignored.
export function clientHighlightTarget(
  params: { get(name: string): string | null },
  tab: string,
  rows: { contactIds: readonly string[]; locationIds: readonly string[] }
): ClientHighlight | null {
  if (tab === "contacts") {
    const id = params.get(CLIENT_CONTACT_PARAM)
    return id && rows.contactIds.includes(id) ? { kind: "contact", id } : null
  }
  if (tab === "locations") {
    const id = params.get(CLIENT_LOCATION_PARAM)
    return id && rows.locationIds.includes(id) ? { kind: "location", id } : null
  }
  return null
}
