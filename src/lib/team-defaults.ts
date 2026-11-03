import type { Prisma, PrismaClient } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

// Every company has one default catch all team, General. It is created the
// first time any team or opportunity route (or the sidebar counts) runs for
// the company, never at company creation and never by a data migration.
// Nobody is added to it automatically.

export const DEFAULT_TEAM_NAME = "General"

type Db = Pick<PrismaClient, "team" | "opportunity" | "$transaction">

// Creates the General team (isDefault) when the company has none and, in
// the same transaction, puts every opportunity of the company that has no
// team into it, so every opportunity has a team. Safe to call on every
// request: once both are true it is two small reads.
//
// Safe under concurrency because the transaction first locks the company's
// own row (SELECT ... FOR NO KEY UPDATE, which leaves foreign key checks on
// other tables alone), so two requests for the same company run one after
// the other. The second one then finds the team the first created and has
// nothing left to move. A failed transaction rolls back both the team and
// the moves, and the next request tries again. A team already named General
// that isn't the default (only possible if the default row was removed by
// hand) becomes the default instead of a second General.
export async function ensureTeamDefaults(companyId: string, db: Db = prisma): Promise<void> {
  const [general, withoutTeam] = await Promise.all([
    db.team.findFirst({ where: { companyId, isDefault: true }, select: { id: true } }),
    db.opportunity.findFirst({ where: { companyId, teamId: null }, select: { id: true } }),
  ])
  if (general && !withoutTeam) return

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR NO KEY UPDATE`
    const teamId = await defaultTeamId(tx, companyId)
    await tx.opportunity.updateMany({ where: { companyId, teamId: null }, data: { teamId } })
  })
}

async function defaultTeamId(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const existing = await tx.team.findFirst({ where: { companyId, isDefault: true }, select: { id: true } })
  if (existing) return existing.id

  const named = await tx.team.findFirst({ where: { companyId, name: DEFAULT_TEAM_NAME }, select: { id: true } })
  if (named) {
    await tx.team.update({ where: { id: named.id }, data: { isDefault: true } })
    return named.id
  }

  // First in the list; teams added later go after it
  const created = await tx.team.create({
    data: { companyId, name: DEFAULT_TEAM_NAME, isDefault: true, sortOrder: 0 },
    select: { id: true },
  })
  return created.id
}

// The company's General team id. Callers run ensureTeamDefaults first.
export async function loadDefaultTeamId(companyId: string, db: Pick<PrismaClient, "team"> = prisma): Promise<string | null> {
  const team = await db.team.findFirst({ where: { companyId, isDefault: true }, select: { id: true } })
  return team?.id ?? null
}
