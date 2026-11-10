import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { ticketListWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { sidebarCounts } from "@/lib/team-rules"
import { TEAM_ORDER } from "@/lib/team-selects"
import { ACTIVE_TICKET_CATEGORIES } from "@/lib/ticket-rules"

// The sidebar's Tickets folder, built the same way as the Opportunities
// one (sidebarCounts): how many OPEN and WAITING tickets the user can see
// in all, per team (queue), unassigned in each team, and per member (by
// assignee). Teams listed are every team with tickets.viewAll, otherwise
// the teams the user is in; members follow visibleTeamMemberIds with the
// ticket keys (a basic user sees only themselves). Every count only
// includes tickets the user may open (ticketListWhere), so nothing from
// another company, out of view, or deleted is counted.
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: "pages.tickets",
    message: "You do not have permission to view tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const viewer = {
    userId: ctx.userId,
    canViewAll: ctx.can("tickets.viewAll"),
    canViewTeam: ctx.can("tickets.viewTeam"),
  }

  const [teams, groups] = await Promise.all([
    prisma.team.findMany({
      // Teams off for tickets aren't in the folder; their open tickets
      // still count in the total (All tickets)
      where: { companyId: ctx.companyId, usesTickets: true, ...(viewer.canViewAll ? {} : { members: { some: { userId: ctx.userId } } }) },
      select: {
        id: true,
        name: true,
        isDefault: true,
        members: { where: { user: { active: true } }, select: { user: { select: { id: true, name: true } } } },
      },
      orderBy: TEAM_ORDER,
    }),
    prisma.ticket.groupBy({
      by: ["teamId", "assigneeId"],
      where: { AND: [ticketListWhere(ctx), { status: { category: { in: [...ACTIVE_TICKET_CATEGORIES] } } }] },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json(
    sidebarCounts(
      viewer,
      teams.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, members: t.members.map((m) => m.user) })),
      groups.map((g) => ({ teamId: g.teamId, ownerId: g.assigneeId, count: g._count._all }))
    )
  )
}
