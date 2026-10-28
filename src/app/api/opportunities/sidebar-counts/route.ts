import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { opportunityListWhere } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { sidebarCounts } from "@/lib/team-rules"
import { TEAM_ORDER } from "@/lib/team-selects"

// The sidebar's Opportunities folder: how many OPEN opportunities the user
// can see in all, per team, unassigned in each team, and per member. Teams
// listed are every team with opportunities.viewAll, otherwise the teams the
// user is in. Members follow visibleTeamMemberIds (a basic user sees only
// themselves). Every count only includes opportunities the user may open
// (opportunityListWhere), so nothing from another company or out of view is
// counted. One request for the whole folder: the teams and one grouped count.
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const viewer = {
    userId: ctx.userId,
    canViewAll: ctx.can("opportunities.viewAll"),
    canViewTeam: ctx.can("opportunities.viewTeam"),
  }

  const [teams, groups] = await Promise.all([
    prisma.team.findMany({
      where: { companyId: ctx.companyId, ...(viewer.canViewAll ? {} : { members: { some: { userId: ctx.userId } } }) },
      select: {
        id: true,
        name: true,
        isDefault: true,
        members: { where: { user: { active: true } }, select: { user: { select: { id: true, name: true } } } },
      },
      orderBy: TEAM_ORDER,
    }),
    prisma.opportunity.groupBy({
      by: ["teamId", "ownerId"],
      where: { AND: [opportunityListWhere(ctx), { stage: { category: "OPEN" } }] },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json(
    sidebarCounts(
      viewer,
      teams.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, members: t.members.map((m) => m.user) })),
      groups.map((g) => ({ teamId: g.teamId, ownerId: g.ownerId, count: g._count._all }))
    )
  )
}
