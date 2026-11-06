import type { TicketStatusCategory } from "@/generated/prisma"

// The rules the ticket, type, priority, status, and settings routes share.
// No database imports, so every rule here can be checked on its own. Text,
// date, and id readers come from src/lib/opportunity-rules.ts (readText,
// readOptionalId, readJsonObject), shared by both records.

export const TICKET_TITLE_MAX = 200
// Type, priority, and status names
export const TICKET_NAME_MAX = 100
// The list's text search
export const TICKET_SEARCH_MAX = 200
// autoCloseResolvedDays: 0 turns auto close off
export const AUTO_CLOSE_DAYS_MAX = 365

export const TICKET_STATUS_CATEGORIES: readonly TicketStatusCategory[] = ["OPEN", "WAITING", "RESOLVED", "CLOSED"]

export const TICKET_CATEGORY_LABELS: Record<TicketStatusCategory, string> = {
  OPEN: "Open",
  WAITING: "Waiting",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
}

export function isTicketStatusCategory(value: unknown): value is TicketStatusCategory {
  return typeof value === "string" && (TICKET_STATUS_CATEGORIES as readonly string[]).includes(value)
}

// The categories the sidebar counts and an "active" list show
export const ACTIVE_TICKET_CATEGORIES: readonly TicketStatusCategory[] = ["OPEN", "WAITING"]

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_TICKET_PREFIX = "T"
export const DEFAULT_AUTO_CLOSE_DAYS = 7
export const DEFAULT_TICKET_TYPES: readonly string[] = ["Incident", "Service Request", "Alert"]
export const DEFAULT_TICKET_PRIORITIES: readonly string[] = ["Low", "Medium", "High", "Urgent"]
// In this order (sortOrder 0 to 5)
export const DEFAULT_TICKET_STATUSES: readonly { name: string; category: TicketStatusCategory }[] = [
  { name: "New", category: "OPEN" },
  { name: "Open", category: "OPEN" },
  { name: "Waiting on customer", category: "WAITING" },
  { name: "On hold", category: "WAITING" },
  { name: "Resolved", category: "RESOLVED" },
  { name: "Closed", category: "CLOSED" },
]
// The starting queues, created as teams when no team of that name exists
export const DEFAULT_TICKET_QUEUES: readonly string[] = ["Helpdesk", "Alerts", "Lv2 Escalation"]
// The queue a new ticket goes to when none is chosen
export const DEFAULT_TICKET_QUEUE = "Helpdesk"

// ─── Status changes ─────────────────────────────────────────────────────────

export interface StatusRef {
  id: string
  category: TicketStatusCategory
}

export interface StatusTimestamps {
  resolvedAt: Date | null
  closedAt: Date | null
}

// resolvedAt and closedAt for a ticket moving from one category to another
// (from is null for a new ticket):
//   OPEN, WAITING: both cleared
//   RESOLVED: resolvedAt set now when it comes from another category
//     (kept when it moves between two RESOLVED statuses), closedAt cleared
//   CLOSED: closedAt set now when it comes from another category (kept
//     between two CLOSED statuses), resolvedAt kept, or set now when it was
//     never resolved
export function statusTimestamps(
  from: TicketStatusCategory | null,
  to: TicketStatusCategory,
  current: StatusTimestamps,
  now: Date
): StatusTimestamps {
  if (to === "OPEN" || to === "WAITING") return { resolvedAt: null, closedAt: null }
  if (to === "RESOLVED") return { resolvedAt: from === "RESOLVED" ? (current.resolvedAt ?? now) : now, closedAt: null }
  return { resolvedAt: current.resolvedAt ?? now, closedAt: from === "CLOSED" ? (current.closedAt ?? now) : now }
}

// What moving a ticket to another status writes: the status,
// statusChangedAt, and the category timestamps. Nothing when the status
// stays the same.
export function ticketStatusChangeData(
  from: StatusRef,
  to: StatusRef,
  current: StatusTimestamps,
  now: Date
): ({ statusId: string; statusChangedAt: Date } & StatusTimestamps) | Record<string, never> {
  if (from.id === to.id) return {}
  return { statusId: to.id, statusChangedAt: now, ...statusTimestamps(from.category, to.category, current, now) }
}

// ─── Assignment ─────────────────────────────────────────────────────────────

export const TICKET_SELF_ASSIGN_ONLY_MESSAGE = "You can only assign tickets to yourself or leave them unassigned"
export const TICKET_TEAM_NOT_MEMBER_MESSAGE = "You can only move tickets to teams you belong to"
export const ASSIGNEE_NOT_IN_TEAM_MESSAGE = "Assignee is not in this team"
export const TEAM_CHANGE_ASSIGNEE_MESSAGE =
  "The assignee is not in the new team. Choose an assignee from that team or leave the ticket unassigned."
export const CONTACT_NEEDS_CLIENT_MESSAGE = "A contact needs a client"
export const LOCATION_NEEDS_CLIENT_MESSAGE = "A location needs a client"

// The reason stored on an assignment round robin made
export const ROUND_ROBIN_REASON = "Round robin"

// ─── Settings ───────────────────────────────────────────────────────────────

export const AUTO_CLOSE_DAYS_MESSAGE = `Auto close must be a whole number of days from 0 (off) to ${AUTO_CLOSE_DAYS_MAX}`

export function isAutoCloseDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= AUTO_CLOSE_DAYS_MAX
}

export const STATUS_CATEGORY_FIXED_MESSAGE = "A status's category can't be changed. Add a new status in that category instead."

export function orderMessages(kind: "type" | "priority" | "status") {
  return {
    invalid: `Invalid ${kind} order`,
    stale: `The ${kind} list changed since you loaded it. Refresh and try again.`,
  }
}

// True when ids is exactly the company's list (current), each once
export function isSameIdList(ids: readonly string[], current: readonly string[]): boolean {
  const known = new Set(current)
  return ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
}

// ─── Delete and change blocks (409) ─────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Added to an in use message when some of those tickets are deleted: a
// deleted ticket keeps its row (so it can be restored)
export function deletedTicketsNote(deleted: number): string {
  if (deleted <= 0) return ""
  const them = deleted === 1 ? "it" : "them"
  return ` ${deleted === 1 ? "One of them is" : `${deleted} of them are`} deleted. Deleted tickets still count because they can be restored: restore ${them} from the audit log and change ${them} first.`
}

// count is null when the database refused the delete and no count was taken
export function ticketSettingInUseMessage(kind: "type" | "priority" | "status", count: number | null, deleted = 0): string {
  const used = count === null ? "tickets" : plural(count, "ticket", "tickets")
  return `This ${kind} is used by ${used}, so it can't be deleted. Move them to another ${kind} first.${deletedTicketsNote(deleted)}`
}

export function lastOfKindMessage(kind: "type" | "priority"): string {
  return `This is the only ticket ${kind}, so it can't be deleted. Every company needs at least one.`
}

export function lastStatusMessage(category: TicketStatusCategory): string {
  return `This is the only ${TICKET_CATEGORY_LABELS[category]} status, so it can't be deleted. Every company needs at least one Open, one Waiting, one Resolved, and one Closed status.`
}

export function statusUsedByButtonMessage(label: string): string {
  return `The "${label}" action button moves to this status. Change or delete that button first.`
}

export function teamTicketsMessage(count: number, deleted = 0): string {
  return `This team has ${plural(count, "ticket", "tickets")}. Move ${count === 1 ? "it" : "them"} to another team before deleting it.${deletedTicketsNote(deleted)}`
}

export const DEFAULT_TICKET_TEAM_DELETE_MESSAGE =
  "New tickets go to this team. Choose another default team in Ticket Settings before deleting it."
