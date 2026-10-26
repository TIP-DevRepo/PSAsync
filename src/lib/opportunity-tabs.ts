// The tabs of the opportunity page's main column (TabsBar, the client page's
// tabs component). No React and no database imports, so each rule can be
// checked on its own.
//
// Adding a tab: add its key to OpportunityTabKey and an entry to
// OPPORTUNITY_TABS (with the permission that shows it, if any), then its
// panel in OpportunityDetail. A later branch adds the Audit log this way:
//   { key: "audit", label: "Audit log", permission: "<the key it defines>" }

export type OpportunityTabKey = "details" | "attachments" | "related"

export interface OpportunityTabDefinition {
  key: OpportunityTabKey
  label: string
  // Shown only to users holding this permission; left out, to everyone who
  // can open the opportunity
  permission?: string
}

export const OPPORTUNITY_TABS: readonly OpportunityTabDefinition[] = [
  { key: "details", label: "Details" },
  { key: "attachments", label: "Attachments" },
  { key: "related", label: "Related" },
]

export const DEFAULT_OPPORTUNITY_TAB: OpportunityTabKey = "details"

// The URL parameter that keeps the open tab (?tab=attachments)
export const OPPORTUNITY_TAB_PARAM = "tab"

export function visibleOpportunityTabs(can: (permission: string) => boolean, tabs: readonly OpportunityTabDefinition[] = OPPORTUNITY_TABS): OpportunityTabDefinition[] {
  return tabs.filter((t) => !t.permission || can(t.permission))
}

// The tab the URL asks for, when the user may see it; otherwise Details
export function readOpportunityTab(params: { get(name: string): string | null }, visible: readonly OpportunityTabDefinition[]): OpportunityTabKey {
  const asked = params.get(OPPORTUNITY_TAB_PARAM)
  return visible.find((t) => t.key === asked)?.key ?? DEFAULT_OPPORTUNITY_TAB
}

// The page's URL with a tab chosen, keeping every other parameter. Details,
// the default, leaves the parameter out.
export function opportunityTabHref(pathname: string, search: string, key: OpportunityTabKey): string {
  const params = new URLSearchParams(search)
  if (key === DEFAULT_OPPORTUNITY_TAB) params.delete(OPPORTUNITY_TAB_PARAM)
  else params.set(OPPORTUNITY_TAB_PARAM, key)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

// A tab's label with its count, shown only when there is at least one
export function tabLabel(label: string, count?: number | null): string {
  return count && count > 0 ? `${label} (${count})` : label
}
