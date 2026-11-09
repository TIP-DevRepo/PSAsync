import type { TicketStatusCategory } from "@/generated/prisma"
import { userChoices, type UserChoice } from "@/lib/user-picker"

// The display rules the ticket screens share: status and priority tones,
// the tickets changed event, the shapes the list and detail routes return,
// and the New ticket dialog's starting values. No React and no database
// imports, so each rule can be checked on its own.

export type Tone = "accent" | "ok" | "warn" | "bad" | "neutral"

// ─── Status and priority display ────────────────────────────────────────────

// A status shows as a pill tinted by its category, never by its name, so a
// renamed or added status still reads right: OPEN the accent, WAITING the
// warning amber, RESOLVED the success green, CLOSED neutral
export const STATUS_CATEGORY_TONE: Record<TicketStatusCategory, Tone> = {
  OPEN: "accent",
  WAITING: "warn",
  RESOLVED: "ok",
  CLOSED: "neutral",
}

export function statusTone(category: TicketStatusCategory | string | null | undefined): Tone {
  return category && category in STATUS_CATEGORY_TONE ? STATUS_CATEGORY_TONE[category as TicketStatusCategory] : "neutral"
}

// A priority's marker follows its place in Ticket Settings' order, never
// its name, so renamed priorities still work: the last one (the top
// priority, Urgent by default) danger, the one before it warning, the one
// before that the accent, and every lower one neutral. priorities is the
// company's list in sortOrder; an unknown id is neutral.
export function priorityTone(priorityId: string, priorities: readonly { id: string }[]): Tone {
  const index = priorities.findIndex((p) => p.id === priorityId)
  if (index < 0) return "neutral"
  const fromTop = priorities.length - 1 - index
  return fromTop === 0 ? "bad" : fromTop === 1 ? "warn" : fromTop === 2 ? "accent" : "neutral"
}

// The same rule for a priority whose place is known (sortOrder) among
// every priority's sortOrder, for a row that carries its own sortOrder
export function priorityToneByOrder(sortOrder: number, allOrders: readonly number[]): Tone {
  const higher = new Set(allOrders.filter((o) => o > sortOrder)).size
  if (!allOrders.includes(sortOrder)) return "neutral"
  return higher === 0 ? "bad" : higher === 1 ? "warn" : higher === 2 ? "accent" : "neutral"
}

// ─── Changes ────────────────────────────────────────────────────────────────

// The window event the sidebar's Tickets folder listens for to reload its
// counts. Pages send it after creating, changing status, reassigning,
// moving queue, or deleting a ticket.
export const TICKETS_CHANGED_EVENT = "psasync:tickets-changed"

export function notifyTicketsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT))
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

export interface TicketOption {
  id: string
  name: string
  sortOrder: number
}

export interface TicketStatusOption extends TicketOption {
  category: TicketStatusCategory
}

// One ticket as the list returns it (ticketListSelect)
export interface TicketRow {
  id: string
  number: string
  title: string
  source: "MANUAL" | "EMAIL" | "NINJAONE"
  statusChangedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  client: { id: string; name: string } | null
  contact: { id: string; firstName: string; lastName: string } | null
  team: { id: string; name: string }
  assignee: { id: string; name: string } | null
  type: { id: string; name: string }
  priority: { id: string; name: string; sortOrder: number }
  status: { id: string; name: string; category: TicketStatusCategory }
}

export const SOURCE_LABELS: Record<TicketRow["source"], string> = {
  MANUAL: "Manual",
  EMAIL: "Email",
  NINJAONE: "NinjaOne",
}

// ─── New tickets ────────────────────────────────────────────────────────────

export interface TicketTeamChoice {
  id: string
  isMember: boolean
  sortOrder: number
}

// The queues a user may put a ticket in (the server's mayUseTicketTeam):
// their own teams, every team with tickets.assign or tickets.viewAll, and
// on create the default ticket team always. keepId keeps the ticket's
// current queue listed so the field shows it.
export function ticketTeamChoices<T extends TicketTeamChoice>(
  teams: readonly T[],
  opts: { canAssign: boolean; canViewAll: boolean; defaultTeamId?: string | null; keepId?: string | null }
): T[] {
  return teams.filter((t) => opts.canAssign || opts.canViewAll || t.isMember || t.id === opts.defaultTeamId || t.id === opts.keepId)
}

// The New ticket dialog's starting queue: the default ticket team when the
// user may use it (on create every creator may), otherwise their first team
// by sortOrder, otherwise "" until the teams load
export function defaultNewTicketTeamId(
  teams: readonly TicketTeamChoice[],
  defaultTeamId: string | null,
  opts: { canAssign: boolean; canViewAll: boolean }
): string {
  const choices = ticketTeamChoices(teams, { ...opts, defaultTeamId })
  if (defaultTeamId && choices.some((t) => t.id === defaultTeamId)) return defaultTeamId
  const own = [...teams].filter((t) => t.isMember).sort((a, b) => a.sortOrder - b.sortOrder)[0]
  return own?.id ?? choices[0]?.id ?? ""
}

// The first of a list in Ticket Settings' order (the default type and
// priority), or ""
export function firstByOrder(options: readonly TicketOption[]): string {
  return [...options].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? ""
}

// Who may be made the assignee in a queue: Unassigned ("") and the team's
// members the user may assign (the team's assignableAssigneeIds from GET
// /api/teams: all its active members with tickets.assign, otherwise only
// the user when they are a member). Names follow the shared user picker
// rule. The current assignee stays listed so the field shows them.
export function assigneeFieldChoices(
  assignableIds: readonly string[],
  users: readonly { id: string; name: string; active: boolean }[],
  current?: { id: string; name: string } | null
): UserChoice[] {
  const candidates: { id: string; name: string }[] = users.filter((u) => u.active && assignableIds.includes(u.id))
  if (current && !candidates.some((u) => u.id === current.id)) candidates.push(current)
  return userChoices(candidates, { unassignedValue: "" })
}

// The note under the Assignee field when the queue has round robin on and
// nobody is chosen
export const ROUND_ROBIN_NOTE = "This queue has round robin on, so a ticket left unassigned goes to the next member in turn."

// ─── Notifications ──────────────────────────────────────────────────────────

// Whether an assignment notifies the new assignee: only when someone is
// newly assigned (not unassigned, not the same person) and the assignee
// isn't the one making the change. actorId is null for the system (round
// robin), which always notifies.
export function notifiesAssignee(change: { from: string | null; to: string | null; actorId: string | null }): boolean {
  if (!change.to || change.to === change.from) return false
  return change.actorId !== change.to
}

// The notification's text: who assigned it, or round robin, or neither
// (the system)
export function ticketAssignedMessage(ticket: { number: string; title: string }, by: { name: string | null; roundRobin?: boolean }): string {
  if (by.roundRobin) return `Ticket ${ticket.number} was assigned to you by round robin: ${ticket.title}`
  return by.name ? `${by.name} assigned ticket ${ticket.number} to you: ${ticket.title}` : `Ticket ${ticket.number} was assigned to you: ${ticket.title}`
}

export const ticketHref = (id: string) => `/dashboard/tickets/${id}`

// ─── Times ──────────────────────────────────────────────────────────────────

// How long ago, the way the list's Updated column shows it: "Just now",
// "4 min ago", "3 hr ago", "Yesterday", then the date
export function relativeTime(value: string, now: Date): string {
  const then = new Date(value)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  if (then.getTime() >= startOfYesterday) return "Yesterday"
  return then.toLocaleDateString()
}

// ─── The client page's Tickets tab ──────────────────────────────────────────

export const CLIENT_TICKET_FILTERS = ["open", "closed", "all"] as const
export type ClientTicketFilter = (typeof CLIENT_TICKET_FILTERS)[number]

export const CLIENT_TICKET_FILTER_LABELS: Record<ClientTicketFilter, string> = { open: "Open", closed: "Closed", all: "All" }

export function isClientTicketFilter(value: unknown): value is ClientTicketFilter {
  return typeof value === "string" && (CLIENT_TICKET_FILTERS as readonly string[]).includes(value)
}

// Open is OPEN and WAITING, closed is RESOLVED and CLOSED, all is no
// condition (null)
export function clientTicketCategories(filter: ClientTicketFilter): readonly TicketStatusCategory[] | null {
  return filter === "open" ? ["OPEN", "WAITING"] : filter === "closed" ? ["RESOLVED", "CLOSED"] : null
}
