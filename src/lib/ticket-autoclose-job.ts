import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { recordTimelineActions } from "@/lib/timeline"
import { recordAudit } from "@/lib/audit-log"
import { ticketStatusAudit } from "@/lib/ticket-audit"
import { moveTicketStatus } from "@/lib/ticket-update"
import { NOT_DELETED_TICKET } from "@/lib/scoped-loaders"
import { TICKET_STATUS_ORDER } from "@/lib/ticket-selects"
import { errorSummary } from "@/lib/user-error"

// The daily ticket auto close job (GET /api/cron/close-resolved-tickets,
// and the dev-only scripts/dev-only/run-ticket-autoclose.ts), like the
// quote expiry job (src/lib/quote-expiry-job.ts).
//
// Which tickets: in a RESOLVED status, not deleted, resolved at least the
// company's autoCloseResolvedDays ago (Ticket Settings; 0 turns it off),
// and with no customer reply since: for now, no EMAIL_IN timeline entry
// after resolvedAt (incoming email arrives in the mailbox phase). Oldest
// resolvedAt first, at most limit per run.
//
// How: each ticket in its own transaction. The row is locked (FOR UPDATE)
// and read again first, so a ticket someone reopened, replied to, or
// deleted meanwhile is skipped and running twice closes nothing new. It
// moves to the company's first CLOSED status by sortOrder (resolvedAt kept,
// closedAt set) as the system (no author, shown as System), with a
// status_changed timeline action holding the reason and a field_changed
// statusId audit entry. One ticket failing is recorded and the rest carry on.

export const CLOSE_TICKETS_DEFAULT_LIMIT = 200

const DAY = 24 * 60 * 60 * 1000
// Candidates read per query while looking for eligible tickets
const PAGE_SIZE = 100

export interface CloseResolvedTicketsOptions {
  now?: Date
  // Only these companies. Left out, every company; an empty list, none.
  companyIds?: readonly string[]
  // At most this many tickets are closed (or, on a dry run, listed) per run
  limit?: number
  // List what would close without changing anything
  dryRun?: boolean
}

export interface AutoCloseItem {
  ticketId: string
  companyId: string
  number: string
  resolvedAt: Date
}

export interface CloseResolvedTicketsResult {
  dryRun: boolean
  // Tickets looked at: RESOLVED and resolved before their company's cutoff
  checked: number
  // Closed (or, on a dry run, that would be)
  closed: number
  // Looked at and left alone: a customer replied since, or it changed meanwhile
  skipped: number
  errors: { ticketId: string; error: string }[]
  // The limit was reached, so more may be waiting for the next run
  limitReached: boolean
  items: AutoCloseItem[]
}

// The reason stored on the status_changed entry
export function autoCloseReason(days: number): string {
  return `No customer reply for ${days} ${days === 1 ? "day" : "days"}`
}

// The resolvedAt a ticket must be at or before to close today
export function autoCloseCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY)
}

const candidateSelect = { id: true, companyId: true, number: true, title: true, resolvedAt: true } satisfies Prisma.TicketSelect
type Candidate = Prisma.TicketGetPayload<{ select: typeof candidateSelect }>

function hasReplySince(db: Pick<Prisma.TransactionClient, "timelineEntry">, ticketId: string, since: Date) {
  return db.timelineEntry.count({ where: { ticketId, kind: "EMAIL_IN", createdAt: { gt: since } } }).then((n) => n > 0)
}

const eligibleWhere = (companyId: string, cutoff: Date): Prisma.TicketWhereInput => ({
  companyId,
  ...NOT_DELETED_TICKET,
  status: { category: "RESOLVED" },
  resolvedAt: { not: null, lte: cutoff },
})

// One ticket to the closed status as the system. False when it no longer
// qualifies.
async function closeOne(ticket: Candidate, closed: { id: string; name: string; category: "CLOSED" }, days: number, now: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticket.id} FOR UPDATE`
    const current = await tx.ticket.findFirst({ where: { id: ticket.id, ...eligibleWhere(ticket.companyId, autoCloseCutoff(now, days)) }, select: { resolvedAt: true } })
    if (!current?.resolvedAt) return false
    if (await hasReplySince(tx, ticket.id, current.resolvedAt)) return false

    const ctx = { companyId: ticket.companyId }
    const move = await moveTicketStatus(tx, ctx, ticket.id, closed, now)
    if (!move) return false
    await recordTimelineActions(tx, {
      companyId: ticket.companyId,
      authorId: null,
      subject: { ticketId: ticket.id },
      actions: [{ action: "status_changed", data: { from: { id: move.from.id, name: move.from.name }, to: { id: closed.id, name: closed.name }, reason: autoCloseReason(days) } }],
      at: now,
    })
    await recordAudit(tx, { companyId: ticket.companyId, actorId: null, entries: [ticketStatusAudit(ticket, move.from, closed)], at: now })
    return true
  })
}

export async function closeResolvedTickets(options: CloseResolvedTicketsOptions = {}): Promise<CloseResolvedTicketsResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(0, Math.floor(options.limit ?? CLOSE_TICKETS_DEFAULT_LIMIT))
  const dryRun = !!options.dryRun
  const result: CloseResolvedTicketsResult = { dryRun, checked: 0, closed: 0, skipped: 0, errors: [], limitReached: false, items: [] }
  if (limit === 0 || options.companyIds?.length === 0) return result

  const companies = await prisma.ticketSettings.findMany({
    where: { autoCloseResolvedDays: { gt: 0 }, ...(options.companyIds ? { companyId: { in: [...options.companyIds] } } : {}) },
    select: { companyId: true, autoCloseResolvedDays: true },
    orderBy: { companyId: "asc" },
  })

  // One company and one ticket at a time, so a run never holds more than one connection
  for (const company of companies) {
    if (result.limitReached) break
    const days = company.autoCloseResolvedDays
    const closed = await prisma.ticketStatus.findFirst({
      where: { companyId: company.companyId, category: "CLOSED" },
      orderBy: TICKET_STATUS_ORDER,
      select: { id: true, name: true },
    })
    if (!closed) continue
    const closedStatus = { ...closed, category: "CLOSED" as const }

    const where = eligibleWhere(company.companyId, autoCloseCutoff(now, days))
    // Closed tickets leave the set as the run goes, so pages skip the ones
    // already looked at by id rather than by a cursor
    const seen: string[] = []
    for (;;) {
      const page: Candidate[] = await prisma.ticket.findMany({
        where: seen.length > 0 ? { AND: [where, { id: { notIn: seen } }] } : where,
        orderBy: [{ resolvedAt: "asc" }, { id: "asc" }],
        take: PAGE_SIZE,
        select: candidateSelect,
      })
      for (const ticket of page) {
        seen.push(ticket.id)
        if (result.closed >= limit) {
          result.limitReached = true
          break
        }
        result.checked++
        if (await hasReplySince(prisma, ticket.id, ticket.resolvedAt as Date)) {
          result.skipped++
          continue
        }
        const item = { ticketId: ticket.id, companyId: ticket.companyId, number: ticket.number, resolvedAt: ticket.resolvedAt as Date }
        if (dryRun) {
          result.closed++
          result.items.push(item)
          continue
        }
        try {
          if (await closeOne(ticket, closedStatus, days, now)) {
            result.closed++
            result.items.push(item)
          } else {
            result.skipped++
          }
        } catch (err) {
          result.errors.push({ ticketId: ticket.id, error: errorSummary(err) })
        }
      }
      if (result.limitReached || page.length < PAGE_SIZE) break
    }
  }
  return result
}
