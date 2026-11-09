import { COLUMN_FILTER_MAX, type ColumnFilters } from "@/lib/column-filters"
import { TICKET_SEARCH_MAX } from "@/lib/ticket-rules"
import { ASSIGNEE_UNASSIGNED, isTicketSortKey, isTicketView, TICKET_FILTER_KEYS, type TicketListQuery } from "@/lib/ticket-list"

// Personal saved views: a user names the list's current filters and sort
// and comes back to them from a tab next to the built in views. Only their
// owner sees them (the SavedView model, one row per view, unique per user,
// page, and name). Every list page that offers them registers here: its
// key, the permission that opens the page, and the reader that checks a
// view's params. A view's params are checked when it is saved, and the
// list request it opens checks every filter again (assertRefs on ids), so
// stored params are never trusted on their own. No React and no database
// imports.
//
// Adopting saved views on another page (Opportunities, say): add its key to
// SAVED_VIEW_PAGES with its permission and a params reader shaped like
// readTicketViewParams, then render SavedViewTabs (src/components/saved-
// views/) next to the page's built in views, turning the page's URL query
// into params and back.

export const SAVED_VIEW_NAME_MAX = 60
export const SAVED_VIEWS_PER_PAGE_MAX = 30

export const SAVED_VIEW_MESSAGES = {
  page: "Invalid page",
  nameRequired: "A view name is required",
  nameTooLong: `A view name must be ${SAVED_VIEW_NAME_MAX} characters or fewer`,
  nameTaken: "You already have a view with that name",
  params: "Invalid view filters",
  tooMany: `You can save up to ${SAVED_VIEWS_PER_PAGE_MAX} views on this page`,
  order: "Invalid view order",
  orderStale: "Your views changed since you loaded them. Refresh and try again.",
} as const

// The ids a view's params name, for the route's assertRefs check
export interface SavedViewRefs {
  teamId?: string
  companyUserId?: string
}

export type ParamsCheck = { value: Record<string, unknown>; refs: SavedViewRefs; error?: undefined } | { error: string; value?: undefined; refs?: undefined }

export interface SavedViewPageRule {
  // Holding it opens the page and its saved views
  permission: string
  readParams: (raw: unknown) => ParamsCheck
}

// ─── Tickets ────────────────────────────────────────────────────────────────

// The params a ticket view keeps: the list's query without its page. Every
// key is optional; anything else, or a value of the wrong shape, refuses
// the whole view.
export interface TicketViewParams {
  view?: string
  q?: string
  team?: string
  assignee?: string
  sort?: string
  dir?: "asc" | "desc"
  filters?: ColumnFilters
}

const TICKET_PARAM_KEYS = ["view", "q", "team", "assignee", "sort", "dir", "filters"] as const
const ID_MAX = 64

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isIdText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX && /^[A-Za-z0-9_-]+$/.test(v)

export function readTicketViewParams(raw: unknown): ParamsCheck {
  const bad = { error: SAVED_VIEW_MESSAGES.params }
  if (!isPlainObject(raw)) return bad
  if (Object.keys(raw).some((k) => !(TICKET_PARAM_KEYS as readonly string[]).includes(k))) return bad
  const value: TicketViewParams = {}
  const refs: SavedViewRefs = {}

  if (raw.view !== undefined) {
    if (!isTicketView(raw.view)) return bad
    value.view = raw.view
  }
  if (raw.q !== undefined) {
    if (typeof raw.q !== "string" || raw.q.length > TICKET_SEARCH_MAX) return bad
    if (raw.q.trim()) value.q = raw.q.trim()
  }
  if (raw.team !== undefined && raw.team !== "") {
    if (!isIdText(raw.team)) return bad
    value.team = raw.team
    refs.teamId = raw.team
  }
  if (raw.assignee !== undefined && raw.assignee !== "") {
    if (!isIdText(raw.assignee)) return bad
    value.assignee = raw.assignee
    if (raw.assignee !== ASSIGNEE_UNASSIGNED) refs.companyUserId = raw.assignee
  }
  if (raw.sort !== undefined && raw.sort !== "") {
    if (!isTicketSortKey(raw.sort)) return bad
    value.sort = raw.sort
  }
  if (raw.dir !== undefined) {
    if (raw.dir !== "asc" && raw.dir !== "desc") return bad
    if (value.sort) value.dir = raw.dir
  }
  if (raw.filters !== undefined) {
    if (!isPlainObject(raw.filters)) return bad
    const filters: ColumnFilters = {}
    for (const [key, text] of Object.entries(raw.filters)) {
      if (!(TICKET_FILTER_KEYS as readonly string[]).includes(key)) return bad
      if (typeof text !== "string" || text.length > COLUMN_FILTER_MAX) return bad
      if (text.trim()) filters[key] = text.trim()
    }
    if (Object.keys(filters).length > 0) value.filters = filters
  }
  return { value: value as Record<string, unknown>, refs }
}

// The list's query as a view's params (no page: a saved view opens on the
// first page)
export function ticketQueryToParams(query: TicketListQuery): TicketViewParams {
  const params: TicketViewParams = { view: query.view }
  if (query.q.trim()) params.q = query.q.trim()
  if (query.team) params.team = query.team
  if (query.assignee) params.assignee = query.assignee
  if (query.sort) {
    params.sort = query.sort
    params.dir = query.dir
  }
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([, v]) => v.trim()))
  if (Object.keys(filters).length > 0) params.filters = filters
  return params
}

// A view's params as the list's query, on its first page. Read leniently
// (as the page reads its URL): anything unknown falls back to the default.
export function ticketParamsToQuery(params: unknown, base: TicketListQuery): TicketListQuery {
  const p = isPlainObject(params) ? params : {}
  const filters: ColumnFilters = {}
  if (isPlainObject(p.filters)) {
    for (const key of TICKET_FILTER_KEYS) {
      const text = p.filters[key]
      if (typeof text === "string" && text.trim()) filters[key] = text.slice(0, COLUMN_FILTER_MAX)
    }
  }
  return {
    view: isTicketView(p.view) ? p.view : base.view,
    q: typeof p.q === "string" ? p.q.slice(0, TICKET_SEARCH_MAX) : "",
    team: typeof p.team === "string" ? p.team : "",
    assignee: typeof p.assignee === "string" ? p.assignee : "",
    sort: isTicketSortKey(p.sort) ? p.sort : "",
    dir: p.dir === "desc" ? "desc" : "asc",
    page: 1,
    filters,
  }
}

// Whether the list's query is exactly what a view holds, so its tab shows
// as the one in use
export function ticketQueryMatchesParams(query: TicketListQuery, params: unknown, base: TicketListQuery): boolean {
  const a = ticketQueryToParams({ ...query, page: 1 })
  const b = ticketQueryToParams(ticketParamsToQuery(params, base))
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(value: unknown): unknown {
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys(value[k])])
  )
}

// ─── Pages ──────────────────────────────────────────────────────────────────

export const SAVED_VIEW_PAGES = {
  tickets: { permission: "pages.tickets", readParams: readTicketViewParams },
} as const satisfies Record<string, SavedViewPageRule>

export type SavedViewPage = keyof typeof SAVED_VIEW_PAGES

export function isSavedViewPage(value: unknown): value is SavedViewPage {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SAVED_VIEW_PAGES, value)
}

// Every page's permission: the routes' any-of rule (holding one opens the
// routes; each request then needs its own page's permission)
export const SAVED_VIEW_PERMISSIONS: string[] = Object.values(SAVED_VIEW_PAGES).map((p) => p.permission)

// A view's name, trimmed
export function readViewName(value: unknown): { value: string; error?: undefined } | { error: string; value?: undefined } {
  if (typeof value !== "string" || !value.trim()) return { error: SAVED_VIEW_MESSAGES.nameRequired }
  const name = value.trim()
  if (name.length > SAVED_VIEW_NAME_MAX) return { error: SAVED_VIEW_MESSAGES.nameTooLong }
  return { value: name }
}

// One view as the routes return it
export interface SavedViewData {
  id: string
  page: string
  name: string
  params: Record<string, unknown>
  sortOrder: number
}
