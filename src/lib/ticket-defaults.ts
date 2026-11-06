import type { Prisma, PrismaClient } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { refusableTransaction, type Refusal } from "@/lib/refusal"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import {
  DEFAULT_AUTO_CLOSE_DAYS,
  DEFAULT_TICKET_PREFIX,
  DEFAULT_TICKET_PRIORITIES,
  DEFAULT_TICKET_QUEUE,
  DEFAULT_TICKET_QUEUES,
  DEFAULT_TICKET_STATUSES,
  DEFAULT_TICKET_TYPES,
} from "@/lib/ticket-rules"

// A company's ticket types, priorities, statuses, settings, and starting
// queues are created the first time any ticket or ticket settings route
// runs for it, never at company creation and never by a data migration.

type Db = Pick<PrismaClient, "ticketSettings" | "team" | "opportunity" | "$transaction">

// Creates, when the company has no ticket settings row yet: the types
// (Incident, Service Request, Alert), priorities (Low, Medium, High,
// Urgent), statuses (New and Open in OPEN, Waiting on customer and On hold
// in WAITING, Resolved, Closed), the settings (prefix T, auto close after 7
// days), and the queues Helpdesk, Alerts, and Lv2 Escalation as teams
// (skipping any name a team already has, ignoring case), with Helpdesk as
// the default team for new tickets. The General team is made first
// (ensureTeamDefaults), so it stays first in the team order. Safe to call
// on every request: once the settings row exists it is two small reads.
//
// Safe under concurrency the same way as ensureOpportunityDefaults: the one
// per company settings row is the claim. Inside one transaction, the
// request that inserts it (INSERT ... ON CONFLICT DO NOTHING on the unique
// companyId) creates everything else; a request racing it blocks on that
// unique index until the winner commits, then inserts nothing and returns.
// If the winner fails, its transaction rolls back the settings row too and
// the next request tries again. The queues are inserted with ON CONFLICT DO
// NOTHING on the unique team name, so a team of that exact name made at the
// same moment is kept rather than failing the defaults.
export async function ensureTicketDefaults(companyId: string, db: Db = prisma): Promise<void> {
  await ensureTeamDefaults(companyId, db)
  const existing = await db.ticketSettings.findUnique({ where: { companyId }, select: { id: true } })
  if (existing) return

  await db.$transaction(async (tx) => {
    const claimed = await tx.ticketSettings.createMany({
      data: [{ companyId, prefix: DEFAULT_TICKET_PREFIX, autoCloseResolvedDays: DEFAULT_AUTO_CLOSE_DAYS }],
      skipDuplicates: true,
    })
    if (claimed.count === 0) return

    // A company that somehow has some of these already keeps them as they are
    if ((await tx.ticketStatus.count({ where: { companyId } })) === 0) {
      await tx.ticketStatus.createMany({ data: DEFAULT_TICKET_STATUSES.map((s, i) => ({ companyId, ...s, sortOrder: i })) })
    }
    if ((await tx.ticketType.count({ where: { companyId } })) === 0) {
      await tx.ticketType.createMany({ data: DEFAULT_TICKET_TYPES.map((name, i) => ({ companyId, name, sortOrder: i })) })
    }
    if ((await tx.ticketPriority.count({ where: { companyId } })) === 0) {
      await tx.ticketPriority.createMany({ data: DEFAULT_TICKET_PRIORITIES.map((name, i) => ({ companyId, name, sortOrder: i })) })
    }

    // The queues go after the company's existing teams
    const teams = await tx.team.findMany({ where: { companyId }, select: { name: true, sortOrder: true } })
    const taken = new Set(teams.map((t) => t.name.toLowerCase()))
    const missing = DEFAULT_TICKET_QUEUES.filter((name) => !taken.has(name.toLowerCase()))
    const next = teams.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1
    if (missing.length > 0) {
      await tx.team.createMany({ data: missing.map((name, i) => ({ companyId, name, sortOrder: next + i })), skipDuplicates: true })
    }
    const helpdesk = await tx.team.findFirst({
      where: { companyId, name: { equals: DEFAULT_TICKET_QUEUE, mode: "insensitive" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    })
    await tx.ticketSettings.update({ where: { companyId }, data: { defaultTeamId: helpdesk?.id ?? null } })
  })
}

export interface TicketSettingsRow {
  prefix: string
  defaultTeamId: string | null
  autoCloseResolvedDays: number
}

// Runs fn in a transaction that first locks the company's ticket settings
// row, which it is handed. Writes that must keep the status rules true
// together (at least one status per category, the default team existing)
// run this way, so two of them for the same company run one after the
// other. The lock only moves updatedAt. A returned Refusal rolls the
// transaction back, so a refused request changes nothing. Callers run
// ensureTicketDefaults first.
export async function withTicketSettingsLock<T>(
  companyId: string,
  fn: (tx: Prisma.TransactionClient, settings: TicketSettingsRow) => Promise<T | Refusal>
): Promise<T | Refusal> {
  return refusableTransaction(async (tx) => {
    const settings = await tx.ticketSettings.update({
      where: { companyId },
      data: { updatedAt: new Date() },
      select: { prefix: true, defaultTeamId: true, autoCloseResolvedDays: true },
    })
    return fn(tx, settings)
  })
}

// The team a new ticket goes to when none is chosen: the settings' default
// team, else the General team. Callers run ensureTicketDefaults first.
export async function loadDefaultTicketTeamId(companyId: string, db: Pick<PrismaClient, "ticketSettings" | "team"> = prisma): Promise<string | null> {
  const settings = await db.ticketSettings.findUnique({ where: { companyId }, select: { defaultTeamId: true } })
  if (settings?.defaultTeamId) return settings.defaultTeamId
  const general = await db.team.findFirst({ where: { companyId, isDefault: true }, select: { id: true } })
  return general?.id ?? null
}
