import type { Prisma, TicketStatusCategory } from "@/generated/prisma"
import { COLUMN_FILTER_MAX, readColumnFilters, writeColumnFilters, type ColumnFilters } from "@/lib/column-filters"
import { TICKET_SEARCH_MAX } from "@/lib/ticket-rules"

// The ticket list's query: the built in view, the search, the queue and
// assignee scope (the sidebar folder's chips), the column filters, the
// sort, and the page. One set of rules for the page's URL, the API's query
// string, so a refresh and a shared link open the same list. The list is
// paged on the server
// (NinjaOne alerts will add many tickets), so filters, sort, and paging all
// run in the database: ticketListFilterWhere and ticketListOrderBy build the
// query, always under ticketListWhere (the visibility rule). No React and
// no database imports; Prisma only for types.

export const TICKET_PAGE_SIZE = 50

// ─── Views ──────────────────────────────────────────────────────────────────

// The built in views. "open" (All open) is the default. "all" (All
// tickets) is the only one that shows resolved and closed tickets.
export const TICKET_VIEWS = ["mine", "unassigned", "open", "waiting", "all"] as const
export type TicketView = (typeof TICKET_VIEWS)[number]
export const DEFAULT_TICKET_VIEW: TicketView = "open"

export const TICKET_VIEW_LABELS: Record<TicketView, string> = {
  mine: "My tickets",
  unassigned: "Unassigned",
  open: "All open",
  waiting: "Waiting",
  all: "All tickets",
}

export function isTicketView(value: unknown): value is TicketView {
  return typeof value === "string" && (TICKET_VIEWS as readonly string[]).includes(value)
}

// OPEN and WAITING: a ticket someone still has to work on. The sidebar
// counts, the Open tile, and every view but All tickets use them.
export const ACTIVE_CATEGORIES: readonly TicketStatusCategory[] = ["OPEN", "WAITING"]

// The condition a view adds, for the signed in user
export function ticketViewWhere(view: TicketView, userId: string): Prisma.TicketWhereInput | null {
  const active = { status: { category: { in: [...ACTIVE_CATEGORIES] } } }
  switch (view) {
    case "mine":
      return { ...active, assigneeId: userId }
    case "unassigned":
      return { ...active, assigneeId: null }
    case "open":
      return active
    case "waiting":
      return { status: { category: "WAITING" } }
    case "all":
      return null
  }
}

// ─── Columns ────────────────────────────────────────────────────────────────

// The list's columns, in order. Each key is its sort key and its column
// filter's URL parameter (f_<key>). Updated has no filter box.
export const TICKET_COLUMN_KEYS = ["number", "subject", "status", "priority", "queue", "assignee", "updated"] as const
export type TicketColumnKey = (typeof TICKET_COLUMN_KEYS)[number]
export const TICKET_FILTER_KEYS: readonly TicketColumnKey[] = ["number", "subject", "status", "priority", "queue", "assignee"]

export function isTicketSortKey(value: unknown): value is TicketColumnKey {
  return typeof value === "string" && (TICKET_COLUMN_KEYS as readonly string[]).includes(value)
}

export type SortDirection = "asc" | "desc"

// The scope value for tickets nobody is assigned to (the folder's
// Unassigned row, ?assignee=unassigned)
export const ASSIGNEE_UNASSIGNED = "unassigned"

// ─── The query ──────────────────────────────────────────────────────────────

export interface TicketListQuery {
  view: TicketView
  q: string
  // A team (queue) id, or ""
  team: string
  // A user id, ASSIGNEE_UNASSIGNED, or ""
  assignee: string
  // "" is the default order, newest first
  sort: TicketColumnKey | ""
  dir: SortDirection
  // 1 based
  page: number
  filters: ColumnFilters
}

export const EMPTY_TICKET_QUERY: TicketListQuery = {
  view: DEFAULT_TICKET_VIEW,
  q: "",
  team: "",
  assignee: "",
  sort: "",
  dir: "asc",
  page: 1,
  filters: {},
}

// A page number from text: a whole number from 1, else null
export function readPageNumber(value: string | null): number | null {
  if (value === null || value === "") return 1
  if (!/^\d{1,6}$/.test(value)) return null
  const n = Number(value)
  return n >= 1 ? n : null
}

type Params = { get(name: string): string | null }

// The page's URL (?view=&q=&team=&assignee=&sort=&dir=&page=&f_<column>=).
// Lenient: anything it doesn't understand falls back to its default, so an
// old or edited link still opens the list. A missing view is the default
// view: All open, or the sidebar layout's choice (src/lib/sidebar-layout.ts).
export function readTicketPageUrl(params: Params, defaultView: TicketView = DEFAULT_TICKET_VIEW): TicketListQuery {
  const view = params.get("view")
  const sort = params.get("sort")
  return {
    view: isTicketView(view) ? view : defaultView,
    q: (params.get("q") ?? "").slice(0, TICKET_SEARCH_MAX),
    team: params.get("team") ?? "",
    assignee: params.get("assignee") ?? "",
    sort: isTicketSortKey(sort) ? sort : "",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: readPageNumber(params.get("page")) ?? 1,
    filters: readColumnFilters(params, TICKET_FILTER_KEYS),
  }
}

// The page's query string ("" or "?..."), leaving every default out (the
// view is left out only when it is the default view the page reads with)
export function ticketPageQuery(query: TicketListQuery, defaultView: TicketView = DEFAULT_TICKET_VIEW): string {
  const params = new URLSearchParams()
  if (query.view !== defaultView) params.set("view", query.view)
  if (query.q.trim()) params.set("q", query.q.trim())
  if (query.team) params.set("team", query.team)
  if (query.assignee) params.set("assignee", query.assignee)
  if (query.sort) {
    params.set("sort", query.sort)
    params.set("dir", query.dir)
  }
  if (query.page > 1) params.set("page", String(query.page))
  const text = writeColumnFilters(params.toString(), query.filters, TICKET_FILTER_KEYS)
  return text ? `?${text}` : ""
}

// The API's query string for GET /api/tickets: the same values under the
// route's names (teamId, assigneeId), the view always sent
export function ticketApiQuery(query: TicketListQuery): string {
  const params = new URLSearchParams()
  params.set("view", query.view)
  if (query.q.trim()) params.set("q", query.q.trim())
  if (query.team) params.set("teamId", query.team)
  if (query.assignee) params.set("assigneeId", query.assignee)
  if (query.sort) {
    params.set("sort", query.sort)
    params.set("dir", query.dir)
  }
  if (query.page > 1) params.set("page", String(query.page))
  return `?${writeColumnFilters(params.toString(), query.filters, TICKET_FILTER_KEYS)}`
}

// Where the sidebar's Tickets folder links: the list, scoped to a queue,
// and to an assignee (a user id or ASSIGNEE_UNASSIGNED) within it
export function ticketFolderHref(team?: string, assignee?: string): string {
  return `/dashboard/tickets${ticketPageQuery({ ...EMPTY_TICKET_QUERY, team: team ?? "", assignee: assignee ?? "" })}`
}

// The API's paging, view, and sort parameters (the route reads its id
// filters itself). Strict: a value it doesn't understand is a 400 with
// this message, never silently ignored.
export type TicketApiOptions = {
  view: TicketView | null
  sort: TicketColumnKey | ""
  dir: SortDirection
  page: number
  filters: ColumnFilters
}

export function readTicketApiOptions(params: Params): { value: TicketApiOptions; error?: undefined } | { error: string; value?: undefined } {
  const view = params.get("view")
  if (view !== null && view !== "" && !isTicketView(view)) return { error: "Invalid view" }
  const sort = params.get("sort")
  if (sort !== null && sort !== "" && !isTicketSortKey(sort)) return { error: "Invalid sort" }
  const dir = params.get("dir")
  if (dir !== null && dir !== "" && dir !== "asc" && dir !== "desc") return { error: "Invalid sort direction" }
  const page = readPageNumber(params.get("page"))
  if (page === null) return { error: "Invalid page" }
  for (const key of TICKET_FILTER_KEYS) {
    const text = params.get(`f_${key}`)
    if (text !== null && text.length > COLUMN_FILTER_MAX) return { error: `A column filter must be ${COLUMN_FILTER_MAX} characters or fewer` }
  }
  return {
    value: {
      // No view (an older caller) lists every ticket, as before
      view: view ? (view as TicketView) : null,
      sort: sort ? (sort as TicketColumnKey) : "",
      dir: dir === "desc" ? "desc" : "asc",
      page,
      filters: readColumnFilters(params, TICKET_FILTER_KEYS),
    },
  }
}

// ─── Database query parts ───────────────────────────────────────────────────

const contains = (text: string) => ({ contains: text, mode: "insensitive" as const })

// The column filters as conditions, each a case insensitive "contains" on
// what the column shows: the number, the title or the client name (the
// Subject column shows both), the status, priority, and queue names, and
// the assignee's name ("Unassigned" for none, so typing part of it finds
// the unassigned ones)
export function ticketColumnFilterWhere(filters: ColumnFilters): Prisma.TicketWhereInput[] {
  const where: Prisma.TicketWhereInput[] = []
  for (const key of TICKET_FILTER_KEYS) {
    const text = (filters[key] ?? "").trim()
    if (!text) continue
    switch (key) {
      case "number":
        where.push({ number: contains(text) })
        break
      case "subject":
        where.push({ OR: [{ title: contains(text) }, { client: { name: contains(text) } }] })
        break
      case "status":
        where.push({ status: { name: contains(text) } })
        break
      case "priority":
        where.push({ priority: { name: contains(text) } })
        break
      case "queue":
        where.push({ team: { name: contains(text) } })
        break
      case "assignee":
        where.push("unassigned".includes(text.toLowerCase()) ? { OR: [{ assigneeId: null }, { assignee: { name: contains(text) } }] } : { assignee: { name: contains(text) } })
        break
    }
  }
  return where
}

// The search box: the title, the number, or the client's name
export function ticketSearchWhere(q: string): Prisma.TicketWhereInput | null {
  const text = q.trim()
  if (!text) return null
  return { OR: [{ title: contains(text) }, { number: contains(text) }, { client: { name: contains(text) } }] }
}

// The order: the chosen column (status and priority by their order in
// Ticket Settings, queue and assignee by name), then newest first, then id,
// so pages never overlap or skip a row when two values tie
export function ticketListOrderBy(sort: TicketColumnKey | "", dir: SortDirection): Prisma.TicketOrderByWithRelationInput[] {
  const tail: Prisma.TicketOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }]
  switch (sort) {
    case "":
      return tail
    case "number":
      return [{ number: dir }, ...tail]
    case "subject":
      return [{ title: dir }, ...tail]
    case "status":
      return [{ status: { sortOrder: dir } }, ...tail]
    case "priority":
      return [{ priority: { sortOrder: dir } }, ...tail]
    case "queue":
      return [{ team: { name: dir } }, ...tail]
    case "assignee":
      return [{ assignee: { name: dir } }, ...tail]
    case "updated":
      return [{ updatedAt: dir }, ...tail]
  }
}

// The page's rows: skip and take
export function pageWindow(page: number, pageSize = TICKET_PAGE_SIZE): { skip: number; take: number } {
  return { skip: (Math.max(1, page) - 1) * pageSize, take: pageSize }
}

export function pageCount(total: number, pageSize = TICKET_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

// The page numbers to show: the first, the last, the current one and its
// neighbors, with null for a gap ("...")
export function pageLinks(current: number, count: number): (number | null)[] {
  const wanted = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count))
  const sorted = [...wanted].sort((a, b) => a - b)
  const links: (number | null)[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) links.push(null)
    links.push(n)
  })
  return links
}

// ─── Stats ──────────────────────────────────────────────────────────────────

// The stat tiles and view counts, for every ticket the user can see in the
// current queue and assignee scope (not the view, search, or column
// filters). From one grouped count of the active tickets.
export interface TicketStats {
  // OPEN and WAITING (All open)
  open: number
  // Of those, assigned to nobody
  unassigned: number
  // In a WAITING status
  waiting: number
  // Of the open ones, in the top priority (the last in Ticket Settings' order)
  urgent: number
  // Of the open ones, assigned to the signed in user (My tickets)
  mine: number
  // The top priority's name, for the Urgent tile's label
  urgentLabel: string
}

export function ticketStats(
  groups: readonly { statusId: string; priorityId: string; assigneeId: string | null; count: number }[],
  statusCategory: ReadonlyMap<string, TicketStatusCategory>,
  topPriority: { id: string; name: string } | null,
  userId: string
): TicketStats {
  const stats: TicketStats = { open: 0, unassigned: 0, waiting: 0, urgent: 0, mine: 0, urgentLabel: topPriority?.name ?? "Urgent" }
  for (const g of groups) {
    const category = statusCategory.get(g.statusId)
    if (category !== "OPEN" && category !== "WAITING") continue
    stats.open += g.count
    if (category === "WAITING") stats.waiting += g.count
    if (g.assigneeId === null) stats.unassigned += g.count
    if (g.assigneeId === userId) stats.mine += g.count
    if (topPriority && g.priorityId === topPriority.id) stats.urgent += g.count
  }
  return stats
}

// The count a view tab shows (All tickets has none: it would need a count
// of the closed ones too)
export function viewCount(view: TicketView, stats: TicketStats): number | undefined {
  switch (view) {
    case "mine":
      return stats.mine
    case "unassigned":
      return stats.unassigned
    case "open":
      return stats.open
    case "waiting":
      return stats.waiting
    case "all":
      return undefined
  }
}
