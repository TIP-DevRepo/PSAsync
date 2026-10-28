// The rules the Opportunities screens share: the URL view and filters, the
// board's columns, owner choices, and the board's optimistic stage move.
// No React and no database imports, so client components can use them and
// each rule can be checked on its own.

import { userChoices } from "@/lib/user-picker"
import { writeColumnFilters } from "@/lib/column-filters"

export type StageCategory = "OPEN" | "WON" | "LOST"

export interface StageOption {
  id: string
  name: string
  category: StageCategory
  sortOrder: number
  winProbability: number
}

export interface TypeOption {
  id: string
  name: string
  sortOrder: number
}

// One row of GET /api/opportunities (opportunityListSelect)
export interface OpportunityRow {
  id: string
  number: string
  title: string
  source: string
  // Decimal as text, for example "1250.5"
  expectedValue: string | null
  // Midnight UTC for a date picked in a date input
  expectedCloseDate: string | null
  stageChangedAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
  client: { id: string; name: string }
  contact: { id: string; firstName: string; lastName: string }
  owner: { id: string; name: string } | null
  // Null only for an opportunity from before teams, until it is moved to General
  team: { id: string; name: string } | null
  stage: { id: string; name: string; category: StageCategory; winProbability: number }
  type: { id: string; name: string } | null
}

// ─── URL view and search ────────────────────────────────────────────────────

export type OpportunityView = "board" | "list"

// The page's own parameters, for both views: the search box, and the team
// and owner the sidebar's Opportunities folder opens (team=<id>,
// owner=<user id> or owner=unassigned), shown as removable chips. The
// list's column filters (f_<column>, src/lib/column-filters.ts) are kept by
// the list itself and only mean something on the list.
export interface OpportunityFilters {
  q: string
  // A team id, or "" for any team
  team: string
  // A user id, OWNER_UNASSIGNED, or "" for any owner
  owner: string
}

export const OWNER_UNASSIGNED = "unassigned"

export const EMPTY_FILTERS: OpportunityFilters = { q: "", team: "", owner: "" }

// An id from the URL: cuid like text only, so nothing odd reaches the API
const URL_ID = /^[A-Za-z0-9_-]{1,64}$/
const readUrlId = (value: string | null) => (value && URL_ID.test(value) ? value : "")

// The same limit the list route has on its search text
export const FILTER_SEARCH_MAX = 200

// Reads the view, search, team, and owner from the URL. An unknown view
// falls back to the board, overlong search text is cut to the API's limit,
// and a team or owner that isn't an id is ignored.
export function readOpportunityUrl(params: { get(name: string): string | null }): { view: OpportunityView; filters: OpportunityFilters } {
  const view: OpportunityView = params.get("view") === "list" ? "list" : "board"
  const q = (params.get("q") ?? "").trim()
  return {
    view,
    filters: { q: q.length > FILTER_SEARCH_MAX ? q.slice(0, FILTER_SEARCH_MAX) : q, team: readUrlId(params.get("team")), owner: readUrlId(params.get("owner")) },
  }
}

// The page's query string for a view and its filters ("" for the board with
// none), the inverse of readOpportunityUrl. Column filters are left out, so
// changing view starts the list without them.
export function opportunityUrlQuery(view: OpportunityView, filters: OpportunityFilters): string {
  const params = new URLSearchParams()
  if (view === "list") params.set("view", "list")
  if (filters.team) params.set("team", filters.team)
  if (filters.owner) params.set("owner", filters.owner)
  if (filters.q.trim()) params.set("q", filters.q.trim())
  const query = params.toString()
  return query ? `?${query}` : ""
}

// The query string for GET /api/opportunities: the search, team (teamId),
// and owner (ownerId, a user id or "unassigned"). The API's other filter
// parameters stay available to other callers.
export function opportunityApiQuery(filters: OpportunityFilters): string {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.team) params.set("teamId", filters.team)
  if (filters.owner) params.set("ownerId", filters.owner)
  const query = params.toString()
  return query ? `?${query}` : ""
}

export function hasActiveFilters(filters: OpportunityFilters): boolean {
  return filters.q.trim() !== "" || filters.team !== "" || filters.owner !== ""
}

// The window event the sidebar's Opportunities folder listens for to reload
// its counts. Pages send it after creating, moving, reassigning, moving to
// another team, or deleting an opportunity.
export const OPPORTUNITIES_CHANGED_EVENT = "psasync:opportunities-changed"

export function notifyOpportunitiesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPPORTUNITIES_CHANGED_EVENT))
}

// Where the sidebar's Opportunities folder links: the board, filtered to a
// team, and to an owner (a user id or OWNER_UNASSIGNED) within it
export function opportunityFolderHref(team?: string, owner?: string): string {
  return `/dashboard/opportunities${opportunityUrlQuery("board", { q: "", team: team ?? "", owner: owner ?? "" })}`
}

// A board column's "N older, view in list": the list with that stage in
// its Stage column filter, keeping the search
export function listForStageHref(pathname: string, filters: OpportunityFilters, stageName: string): string {
  const query = writeColumnFilters(opportunityUrlQuery("list", filters).slice(1), { stage: stageName }, ["stage"])
  return `${pathname}?${query}`
}

// ─── Owners ─────────────────────────────────────────────────────────────────

export interface OwnerChoice {
  value: string
  label: string
}

interface UserOption {
  id: string
  name: string
  active: boolean
}

// Who may be made the owner in a team: Unassigned ("") and the team's
// members the current user may assign (the team's assignableOwnerIds from
// GET /api/teams, which follows mayAssignOpportunityTo and the rule that an
// owner is a member of the opportunity's team). Labels and order follow the
// shared user picker rule (src/lib/user-picker.ts): names, never "Me",
// alphabetical, Unassigned first; names come from the user list (GET
// /api/users), so a member is left out until it loads. The current owner
// stays listed even when they can no longer be chosen (deactivated, or not
// in the team), so the field shows them.
export function ownerFieldChoices(
  assignableOwnerIds: readonly string[],
  users: UserOption[],
  currentOwner?: { id: string; name: string } | null
): OwnerChoice[] {
  const candidates: { id: string; name: string }[] = users.filter((u) => u.active && assignableOwnerIds.includes(u.id))
  if (currentOwner && !candidates.some((u) => u.id === currentOwner.id)) candidates.push(currentOwner)
  return userChoices(candidates, { unassignedValue: "" })
}

// ─── Money ──────────────────────────────────────────────────────────────────

// "1250.5" as 125050 cents, so totals add up without float drift
export function valueCents(value: string | null | undefined): number {
  if (!value) return 0
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── Board ──────────────────────────────────────────────────────────────────

// Won and Lost columns show only opportunities closed this recently
export const CLOSED_COLUMN_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export function isClosedCategory(category: StageCategory): boolean {
  return category !== "OPEN"
}

// Closed within the last CLOSED_COLUMN_DAYS days. One with no close date
// counts as older.
export function isRecentlyClosed(closedAt: string | null, now: Date): boolean {
  if (!closedAt) return false
  const time = Date.parse(closedAt)
  return !Number.isNaN(time) && now.getTime() - time <= CLOSED_COLUMN_DAYS * DAY
}

export interface BoardColumn<T extends OpportunityRow = OpportunityRow> {
  stage: StageOption
  cards: T[]
  // The cards' count and total value
  count: number
  totalCents: number
  // Won and Lost only: cards in the stage closed longer ago, left off the board
  olderCount: number
}

// One column per stage, in the order given (the company's sortOrder). Value
// is expectedValue for now. Branch 3 switches it to the latest quote total.
export function boardColumns<T extends OpportunityRow>(stages: StageOption[], opportunities: T[], now: Date): BoardColumn<T>[] {
  return stages.map((stage) => {
    const inStage = opportunities.filter((o) => o.stage.id === stage.id)
    const cards = isClosedCategory(stage.category) ? inStage.filter((o) => isRecentlyClosed(o.closedAt, now)) : inStage
    return {
      stage,
      cards,
      count: cards.length,
      totalCents: cards.reduce((sum, o) => sum + valueCents(o.expectedValue), 0),
      olderCount: inStage.length - cards.length,
    }
  })
}

// ─── Optimistic stage move ──────────────────────────────────────────────────

// The list with one opportunity moved to a stage, the way the server's
// stageChangeData writes it: stageChangedAt now, closedAt set moving into
// WON or LOST and cleared moving into OPEN
export function withStageMove<T extends OpportunityRow>(list: T[], id: string, stage: StageOption, now: Date): T[] {
  return list.map((o) =>
    o.id === id && o.stage.id !== stage.id
      ? {
          ...o,
          stage: { id: stage.id, name: stage.name, category: stage.category, winProbability: stage.winProbability },
          stageChangedAt: now.toISOString(),
          closedAt: isClosedCategory(stage.category) ? now.toISOString() : null,
        }
      : o
  )
}

export type StageSaveResult<T> = { ok: true; opportunity: T } | { ok: false; error?: string }

// Moves a card at once, then saves it. On success the card takes the
// server's copy; on failure (or a request that never answers) the card is
// put back exactly as it was and the error is returned for a toast.
export async function moveOpportunityStage<T extends OpportunityRow>(opts: {
  card: T
  stage: StageOption
  now: Date
  update: (fn: (list: T[]) => T[]) => void
  save: (id: string, stageId: string) => Promise<StageSaveResult<T>>
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { card, stage, now, update, save } = opts
  if (card.stage.id === stage.id) return { ok: true }

  update((list) => withStageMove(list, card.id, stage, now))

  let result: StageSaveResult<T>
  try {
    result = await save(card.id, stage.id)
  } catch {
    result = { ok: false }
  }

  if (result.ok) {
    const saved = result.opportunity
    update((list) => list.map((o) => (o.id === card.id ? saved : o)))
    return { ok: true }
  }
  update((list) => list.map((o) => (o.id === card.id ? card : o)))
  return { ok: false, error: result.error || "The change was not saved. Try again." }
}

// ─── Display ────────────────────────────────────────────────────────────────

// A date only value (stored as midnight UTC) shown as that calendar day
export function formatDateOnly(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-"
}

// A real time (closed, created, updated) shown as the user's local day
export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "-"
}

// The teams an opportunity may be put in by the current user (the server's
// rule): the teams they are in, all of them with opportunities.viewAll, and
// on create General (isDefault) always. keepId keeps the opportunity's
// current team listed so the field shows it.
export function teamChoices<T extends { id: string; isDefault: boolean; isMember: boolean }>(
  teams: readonly T[],
  canViewAll: boolean,
  opts: { includeDefault?: boolean; keepId?: string | null } = {}
): T[] {
  return teams.filter((t) => canViewAll || t.isMember || (opts.includeDefault && t.isDefault) || t.id === opts.keepId)
}

export function contactName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim()
}

// ─── Client details ─────────────────────────────────────────────────────────

export interface ClientLocationSummary {
  id: string
  name: string
  isPrimary?: boolean
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
}

// A location's address as lines (street, second line, "City, ST 12345",
// country), leaving out what is empty
export function addressLines(location: ClientLocationSummary): string[] {
  const cityLine = [[location.city, location.state].filter(Boolean).join(", "), location.zip].filter(Boolean).join(" ")
  return [location.address, location.address2, cityLine, location.country].filter((line): line is string => !!line && line.trim() !== "")
}
