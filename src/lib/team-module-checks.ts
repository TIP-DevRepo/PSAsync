// Server side only (it reads the database): the team module rules of
// src/lib/team-modules.ts applied to requests.
import type { PrismaClient } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/api-access"
import { teamWhere } from "@/lib/scoped-loaders"
import { TEAM_ORDER } from "@/lib/team-selects"
import { defaultOpportunityTeam, TEAM_NOT_FOR_MODULE_CODE, teamNotForModuleMessage, teamUsesModule, type TeamModule } from "@/lib/team-modules"

// 400 when a new or moved record names a team of the company that is off
// for its module, otherwise null. Run after assertRefs has checked the id
// is the company's (a team that isn't the company's is left to that check).
export async function teamModuleRefusal(ctx: { companyId: string }, teamId: string, module: TeamModule) {
  const team = await prisma.team.findFirst({ where: teamWhere(ctx, teamId), select: { usesTickets: true, usesOpportunities: true } })
  if (team && !teamUsesModule(team, module)) return apiError(400, teamNotForModuleMessage(module), TEAM_NOT_FOR_MODULE_CODE)
  return null
}

// The team a new opportunity goes to when none is chosen (the New
// opportunity form left on the default, an opportunity made from a quote):
// General while it uses opportunities, otherwise the first team that does
export async function loadDefaultOpportunityTeamId(companyId: string, db: Pick<PrismaClient, "team"> = prisma): Promise<string | null> {
  const teams = await db.team.findMany({
    where: { companyId },
    select: { id: true, isDefault: true, usesOpportunities: true },
    orderBy: TEAM_ORDER,
  })
  return defaultOpportunityTeam(teams)?.id ?? null
}
