// The tabs of the ticket page's main column (TabsBar), kept in the URL
// (?tab=<key>) like the opportunity page's. No React and no database
// imports, so each rule can be checked on its own.
//
// Adding a tab: add its key to TicketTabKey and an entry to TICKET_TABS
// (with the permission that shows it, if any), then its panel in
// TicketDetail.

import { readTabParam, tabHref } from "@/lib/tab-url"

export type TicketTabKey = "details" | "attachments" | "related" | "audit"

export interface TicketTabDefinition {
  key: TicketTabKey
  label: string
  // Shown only to users holding this permission
  permission?: string
}

export const TICKET_TABS: readonly TicketTabDefinition[] = [
  { key: "details", label: "Details" },
  { key: "attachments", label: "Attachments" },
  { key: "related", label: "Related" },
  { key: "audit", label: "Audit log", permission: "auditLog.view" },
]

export const DEFAULT_TICKET_TAB: TicketTabKey = "details"

export function visibleTicketTabs(can: (permission: string) => boolean): TicketTabDefinition[] {
  return TICKET_TABS.filter((t) => !t.permission || can(t.permission))
}

// The tab the URL asks for, when the user may see it; otherwise Details
export function readTicketTab(params: { get(name: string): string | null }, visible: readonly TicketTabDefinition[]): TicketTabKey {
  return readTabParam(params, visible.map((t) => t.key), DEFAULT_TICKET_TAB)
}

export function ticketTabHref(pathname: string, search: string, key: TicketTabKey): string {
  return tabHref(pathname, search, key, DEFAULT_TICKET_TAB)
}
