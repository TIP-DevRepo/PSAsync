// The sidebar's layout: which pages it has, in which sections, and how a
// saved layout (the company's, then the user's) changes their order, the
// order of the teams in each folder, which folders start open, and the
// Opportunities and Tickets default views. No React and no database
// imports, so the server (the dashboard layout, the routes) and the
// settings screens share one set of rules.
//
// Resolution, for every part on its own: the user's layout (only while the
// company allows it), then the company's, then the PSAsync default. An
// order is layered rather than replaced: each layer's keys come first in
// its order, and everything it doesn't name keeps the order of the layer
// below. So a page or team added later appears at the end of its group,
// and a key nobody knows any more is simply dropped. Who may see a page is
// never decided here: the sidebar filters by the user's permissions after
// ordering, so a saved order can't show a page the user can't open.

import { TICKET_VIEW_LABELS, TICKET_VIEWS, DEFAULT_TICKET_VIEW, type TicketView } from "@/lib/ticket-list"
import type { OpportunityView } from "@/lib/opportunity-view"

// ─── The pages ──────────────────────────────────────────────────────────────

// The page permissions a sidebar entry can need (the keys of
// resolvePagePermissions in src/lib/permissions.ts)
export type SidebarPageKey =
  | "clients"
  | "catalog"
  | "vendors"
  | "quotes"
  | "opportunities"
  | "tickets"
  | "settings"
  | "salesOrders"
  | "purchaseOrders"
  | "inventory"

// The icon names the sidebar draws (NAV_ICON_PATHS in
// src/components/layout/sidebar.tsx)
export type SidebarIconName = "home" | "opp" | "ticket" | "quote" | "so" | "po" | "client" | "vendor" | "catalog" | "inv" | "settings" | "updates"

export interface SidebarItemDef {
  // Stable: saved layouts refer to it. Never rename one; add a new key.
  key: string
  label: string
  href: string
  icon: SidebarIconName
  // null: every signed in user
  permission: SidebarPageKey | null
}

export interface SidebarSectionDef {
  key: string
  label: string
  items: SidebarItemDef[]
}

// Every page, in the design's sections, in the PSAsync default order. A
// page added in a later release goes in its section here, and it then
// shows at the end of that section for every saved layout.
export const SIDEBAR_SECTIONS: readonly SidebarSectionDef[] = [
  {
    key: "work",
    label: "Work",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home", permission: null },
      { key: "tickets", label: "Tickets", href: "/dashboard/tickets", icon: "ticket", permission: "tickets" },
      { key: "opportunities", label: "Opportunities", href: "/dashboard/opportunities", icon: "opp", permission: "opportunities" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    items: [
      { key: "quotes", label: "Quotes", href: "/dashboard/quotes", icon: "quote", permission: "quotes" },
      { key: "salesOrders", label: "Sales Orders", href: "/dashboard/sales-orders", icon: "so", permission: "salesOrders" },
      { key: "purchaseOrders", label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: "po", permission: "purchaseOrders" },
    ],
  },
  {
    key: "records",
    label: "Records",
    items: [
      { key: "clients", label: "Clients", href: "/dashboard/clients", icon: "client", permission: "clients" },
      { key: "vendors", label: "Vendors", href: "/dashboard/vendors", icon: "vendor", permission: "vendors" },
      { key: "catalog", label: "Catalog", href: "/dashboard/catalog", icon: "catalog", permission: "catalog" },
      { key: "inventory", label: "Inventory", href: "/dashboard/inventory", icon: "inv", permission: "inventory" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { key: "settings", label: "Settings", href: "/dashboard/settings", icon: "settings", permission: "settings" },
      { key: "updates", label: "Features & Updates", href: "/dashboard/updates", icon: "updates", permission: null },
    ],
  },
]

export const SIDEBAR_SECTION_KEYS = SIDEBAR_SECTIONS.map((s) => s.key)

// The entries that are folders of teams (TeamFolder), by item key
export const SIDEBAR_FOLDER_KEYS = ["tickets", "opportunities"] as const
export type SidebarFolderKey = (typeof SIDEBAR_FOLDER_KEYS)[number]

export const SIDEBAR_FOLDER_LABELS: Record<SidebarFolderKey, string> = {
  tickets: "Tickets",
  opportunities: "Opportunities",
}

// The page permission each folder needs (a folder is a sidebar entry)
export const SIDEBAR_FOLDER_PERMISSION: Record<SidebarFolderKey, SidebarPageKey> = {
  tickets: "tickets",
  opportunities: "opportunities",
}

export function isSidebarFolderKey(value: unknown): value is SidebarFolderKey {
  return typeof value === "string" && (SIDEBAR_FOLDER_KEYS as readonly string[]).includes(value)
}

// ─── Default views ──────────────────────────────────────────────────────────

export const OPPORTUNITY_DEFAULT_VIEWS = ["board", "list"] as const satisfies readonly OpportunityView[]
export const OPPORTUNITY_VIEW_LABELS: Record<OpportunityView, string> = { board: "Board", list: "List" }
export const TICKET_DEFAULT_VIEWS: readonly TicketView[] = TICKET_VIEWS
export { TICKET_VIEW_LABELS }

export interface SidebarDefaultViews {
  opportunities: OpportunityView
  tickets: TicketView
}

export const PSASYNC_DEFAULT_VIEWS: SidebarDefaultViews = { opportunities: "board", tickets: DEFAULT_TICKET_VIEW }

// ─── Saved and resolved layouts ─────────────────────────────────────────────

export interface SidebarFolderLayout {
  // Team ids, first to last; teams not listed follow in their own order
  teamOrder?: string[]
  openByDefault?: boolean
}

// What a company or a user saves (CompanySettings.sidebarLayout,
// UserPreferences.sidebarLayout). Every part is optional: a part left out
// follows the layer below. Read and written only through
// src/lib/sidebar-layout-schema.ts.
export interface SidebarLayout {
  // Item keys of each section, first to last
  sections?: Partial<Record<string, string[]>>
  folders?: Partial<Record<SidebarFolderKey, SidebarFolderLayout>>
  defaultViews?: Partial<SidebarDefaultViews>
}

export interface ResolvedSidebarFolder {
  teamOrder: string[]
  openByDefault: boolean
}

// The layout the sidebar uses: every section and every page in order
// (permissions not applied yet), each folder's team order and open state,
// and the default views
export interface ResolvedSidebarLayout {
  sections: SidebarSectionDef[]
  folders: Record<SidebarFolderKey, ResolvedSidebarFolder>
  defaultViews: SidebarDefaultViews
}

// One layer of an order over another: the layer's keys that `base` holds,
// in the layer's order and once each, then the rest of `base` in its own
// order. Keys `base` doesn't hold (removed pages, deleted teams, anything
// made up) are dropped.
export function layerOrder(base: readonly string[], layer: readonly string[] | undefined): string[] {
  if (!layer || layer.length === 0) return [...base]
  const known = new Set(base)
  const first: string[] = []
  const seen = new Set<string>()
  for (const key of layer) {
    if (known.has(key) && !seen.has(key)) {
      seen.add(key)
      first.push(key)
    }
  }
  return [...first, ...base.filter((key) => !seen.has(key))]
}

// The same for lists whose keys aren't known up front (team ids): the
// layer's ids first, then the base's ids it didn't name. Ids of teams that
// no longer exist are harmless here; orderTeams only places teams it is
// given.
function layerOpenOrder(base: readonly string[], layer: readonly string[] | undefined): string[] {
  return uniqueStrings([...(layer ?? []), ...base])
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export interface SidebarLayers {
  company: SidebarLayout | null
  user: SidebarLayout | null
  // CompanySettings.allowUserSidebar: off, the user's layout is ignored
  allowUser: boolean
}

// The layout in use: the user's (only when allowed), over the company's,
// over the PSAsync default
export function resolveSidebarLayout({ company, user, allowUser }: SidebarLayers): ResolvedSidebarLayout {
  const layers = [company, allowUser ? user : null].filter((l): l is SidebarLayout => l !== null)

  const sections = SIDEBAR_SECTIONS.map((section) => {
    const byKey = new Map(section.items.map((item) => [item.key, item]))
    let order = section.items.map((item) => item.key)
    for (const layer of layers) order = layerOrder(order, layer.sections?.[section.key])
    return { ...section, items: order.map((key) => byKey.get(key)!) }
  })

  const folders = {} as Record<SidebarFolderKey, ResolvedSidebarFolder>
  for (const key of SIDEBAR_FOLDER_KEYS) {
    let teamOrder: string[] = []
    let openByDefault = false
    for (const layer of layers) {
      const folder = layer.folders?.[key]
      teamOrder = layerOpenOrder(teamOrder, folder?.teamOrder)
      if (typeof folder?.openByDefault === "boolean") openByDefault = folder.openByDefault
    }
    folders[key] = { teamOrder, openByDefault }
  }

  const defaultViews = { ...PSASYNC_DEFAULT_VIEWS }
  for (const layer of layers) {
    const views = layer.defaultViews
    if (views?.opportunities && (OPPORTUNITY_DEFAULT_VIEWS as readonly string[]).includes(views.opportunities)) defaultViews.opportunities = views.opportunities
    if (views?.tickets && TICKET_DEFAULT_VIEWS.includes(views.tickets)) defaultViews.tickets = views.tickets
  }

  return { sections, folders, defaultViews }
}

export const PSASYNC_SIDEBAR_LAYOUT: ResolvedSidebarLayout = resolveSidebarLayout({ company: null, user: null, allowUser: false })

// The sections and pages a user may see, in the layout's order: a page
// without its permission is left out whatever the order says, and a
// section with nothing left is left out too
export function visibleSidebarSections(
  layout: ResolvedSidebarLayout,
  pagePermissions: Partial<Record<SidebarPageKey, boolean>>
): SidebarSectionDef[] {
  return layout.sections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.permission === null || pagePermissions[item.permission] === true) }))
    .filter((section) => section.items.length > 0)
}

// A folder's teams in the layout's order: the ids it names first, then
// every other team in the order it came in (the teams' own sortOrder).
// Teams the user can't see aren't in `teams`, so they never show.
export function orderTeams<T extends { id: string }>(teams: readonly T[], teamOrder: readonly string[]): T[] {
  const byId = new Map(teams.map((team) => [team.id, team]))
  return layerOrder(
    teams.map((team) => team.id),
    teamOrder
  ).map((id) => byId.get(id)!)
}

// A resolved layout as a saved one, so an editor can start from what the
// user sees and save it whole
export function layoutFromResolved(resolved: ResolvedSidebarLayout): SidebarLayout {
  const folders: Partial<Record<SidebarFolderKey, SidebarFolderLayout>> = {}
  for (const key of SIDEBAR_FOLDER_KEYS) folders[key] = { teamOrder: [...resolved.folders[key].teamOrder], openByDefault: resolved.folders[key].openByDefault }
  return {
    sections: Object.fromEntries(resolved.sections.map((s) => [s.key, s.items.map((i) => i.key)])),
    folders,
    defaultViews: { ...resolved.defaultViews },
  }
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((key, i) => key === (b ?? [])[i])

// Only the parts of `next` that differ from `base` (both full layouts, as
// layoutFromResolved makes them), so a saved layout holds just what was
// changed and everything else keeps following the layer below: a user who
// only picks a default view still gets the company's later reorders.
export function diffSidebarLayout(base: SidebarLayout, next: SidebarLayout): SidebarLayout {
  const out: SidebarLayout = {}

  const sections: Record<string, string[]> = {}
  for (const [key, order] of Object.entries(next.sections ?? {})) {
    if (order && !sameList(order, base.sections?.[key])) sections[key] = [...order]
  }
  if (Object.keys(sections).length > 0) out.sections = sections

  const folders: Partial<Record<SidebarFolderKey, SidebarFolderLayout>> = {}
  for (const key of SIDEBAR_FOLDER_KEYS) {
    const was = base.folders?.[key]
    const now = next.folders?.[key]
    if (!now) continue
    const folder: SidebarFolderLayout = {}
    if (now.teamOrder && !sameList(now.teamOrder, was?.teamOrder)) folder.teamOrder = [...now.teamOrder]
    if (typeof now.openByDefault === "boolean" && now.openByDefault !== (was?.openByDefault ?? false)) folder.openByDefault = now.openByDefault
    if (Object.keys(folder).length > 0) folders[key] = folder
  }
  if (Object.keys(folders).length > 0) out.folders = folders

  const views: Partial<SidebarDefaultViews> = {}
  if (next.defaultViews?.opportunities && next.defaultViews.opportunities !== base.defaultViews?.opportunities) views.opportunities = next.defaultViews.opportunities
  if (next.defaultViews?.tickets && next.defaultViews.tickets !== base.defaultViews?.tickets) views.tickets = next.defaultViews.tickets
  if (Object.keys(views).length > 0) out.defaultViews = views

  return out
}

// A new order for the keys a user can see, written back into the full list:
// each visible key's slot takes the next key of `visibleOrder`, and keys the
// user can't see stay where they were
export function replaceVisibleOrder(full: readonly string[], visibleOrder: readonly string[]): string[] {
  const visible = new Set(visibleOrder)
  let next = 0
  return full.map((key) => (visible.has(key) ? visibleOrder[next++] : key))
}

// A saved layout cleaned of everything this release doesn't know: unknown
// sections and pages dropped, each page and team once, and only the folder
// and view values that exist. The routes store layouts through it, so the
// database only ever holds known keys (anything it once held that a later
// release removes is dropped again when read).
export function normalizeSidebarLayout(layout: SidebarLayout): SidebarLayout {
  const out: SidebarLayout = {}

  if (layout.sections) {
    const sections: Record<string, string[]> = {}
    for (const section of SIDEBAR_SECTIONS) {
      const saved = layout.sections[section.key]
      if (!saved) continue
      const known = new Set(section.items.map((i) => i.key))
      sections[section.key] = uniqueStrings(saved.filter((key) => known.has(key)))
    }
    out.sections = sections
  }

  if (layout.folders) {
    const folders: Partial<Record<SidebarFolderKey, SidebarFolderLayout>> = {}
    for (const key of SIDEBAR_FOLDER_KEYS) {
      const saved = layout.folders[key]
      if (!saved) continue
      const folder: SidebarFolderLayout = {}
      if (saved.teamOrder) folder.teamOrder = uniqueStrings(saved.teamOrder)
      if (typeof saved.openByDefault === "boolean") folder.openByDefault = saved.openByDefault
      folders[key] = folder
    }
    out.folders = folders
  }

  if (layout.defaultViews) {
    const views: Partial<SidebarDefaultViews> = {}
    const { opportunities, tickets } = layout.defaultViews
    if (opportunities && (OPPORTUNITY_DEFAULT_VIEWS as readonly string[]).includes(opportunities)) views.opportunities = opportunities
    if (tickets && TICKET_DEFAULT_VIEWS.includes(tickets)) views.tickets = tickets
    out.defaultViews = views
  }

  return out
}

// Keeps only the team ids `allowed` holds (the caller's company's teams), so
// a stored layout never names another company's team
export function keepKnownTeams(layout: SidebarLayout, allowed: ReadonlySet<string>): SidebarLayout {
  if (!layout.folders) return layout
  const folders: Partial<Record<SidebarFolderKey, SidebarFolderLayout>> = {}
  for (const key of SIDEBAR_FOLDER_KEYS) {
    const folder = layout.folders[key]
    if (!folder) continue
    folders[key] = folder.teamOrder ? { ...folder, teamOrder: folder.teamOrder.filter((id) => allowed.has(id)) } : { ...folder }
  }
  return { ...layout, folders }
}

// Every team id a layout names, to check against the company in one query
export function layoutTeamIds(layout: SidebarLayout): string[] {
  return uniqueStrings(SIDEBAR_FOLDER_KEYS.flatMap((key) => layout.folders?.[key]?.teamOrder ?? []))
}

// The company switch message and code (PATCH /api/account/sidebar)
export const SIDEBAR_LOCKED_MESSAGE = "Your company has turned off personal sidebar layouts, so the company layout applies to everyone."
export const SIDEBAR_LOCKED_CODE = "SIDEBAR_LOCKED"
