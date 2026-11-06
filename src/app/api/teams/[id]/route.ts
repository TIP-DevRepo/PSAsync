import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { DELETED_OPPORTUNITY, DELETED_TICKET, loadTeam, teamWhere } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { teamSelect } from "@/lib/team-selects"
import { DEFAULT_TEAM_DELETE_MESSAGE, TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX, TEAM_NAME_TAKEN_MESSAGE, teamInUseMessage } from "@/lib/team-rules"
import { toTeamResponse } from "@/lib/teams"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject, readText } from "@/lib/opportunity-rules"
import { DEFAULT_TICKET_TEAM_DELETE_MESSAGE, teamTicketsMessage } from "@/lib/ticket-rules"
import { userFacingError } from "@/lib/user-error"

// Renames a team, changes its description (General too), or turns round
// robin on or off (roundRobinEnabled: new tickets created unassigned in the
// team go to its next active member). Members and default roles have their
// own routes.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.teams",
    message: "You do not have permission to manage teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const existing = await loadTeam(ctx, id)
  if (!existing) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: { name?: string; description?: string | null; roundRobinEnabled?: boolean } = {}
  if ("name" in body) {
    const name = readText(body.name, { label: "Team name", max: TEAM_NAME_MAX, required: true })
    if (name.error !== undefined) return apiError(400, name.error)
    const duplicate = await prisma.team.findFirst({
      where: { companyId: ctx.companyId, id: { not: existing.id }, name: { equals: name.value as string, mode: "insensitive" } },
      select: { id: true },
    })
    if (duplicate) return apiError(400, TEAM_NAME_TAKEN_MESSAGE)
    data.name = name.value as string
  }
  if ("description" in body) {
    const description = readText(body.description, { label: "Description", max: TEAM_DESCRIPTION_MAX })
    if (description.error !== undefined) return apiError(400, description.error)
    data.description = description.value
  }
  if ("roundRobinEnabled" in body) {
    if (typeof body.roundRobinEnabled !== "boolean") return apiError(400, "Round robin must be true or false")
    data.roundRobinEnabled = body.roundRobinEnabled
  }

  try {
    const team = await prisma.team.update({ where: teamWhere(ctx, existing.id), data, select: teamSelect })
    return NextResponse.json(toTeamResponse(team, ctx))
  } catch (err) {
    if (isPrismaError(err, "P2002")) return apiError(400, TEAM_NAME_TAKEN_MESSAGE)
    const { message, status } = userFacingError(err, "Editing a team")
    return apiError(status, message)
  }
}

// General can't be deleted, and neither can a team any opportunity or
// ticket is in, deleted ones included, or the team new tickets go to
// (Ticket Settings) (409). Its memberships and default roles go with it,
// so its members lose those roles unless they hold them some other way.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.teams",
    message: "You do not have permission to manage teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const team = await prisma.team.findFirst({
    where: teamWhere(ctx, id),
    select: { id: true, isDefault: true, _count: { select: { opportunities: true, tickets: true, ticketSettingsDefault: true } } },
  })
  if (!team) return notFound()
  if (team.isDefault) return apiError(409, DEFAULT_TEAM_DELETE_MESSAGE, "DEFAULT_TEAM")
  // Deleted opportunities still belong to the team (their rows are kept)
  const deletedInTeam = () => prisma.opportunity.count({ where: { teamId: team.id, companyId: ctx.companyId, ...DELETED_OPPORTUNITY } })
  if (team._count.opportunities > 0) return apiError(409, teamInUseMessage(team._count.opportunities, await deletedInTeam()), "TEAM_IN_USE")
  const deletedTicketsInTeam = () => prisma.ticket.count({ where: { teamId: team.id, companyId: ctx.companyId, ...DELETED_TICKET } })
  if (team._count.tickets > 0) return apiError(409, teamTicketsMessage(team._count.tickets, await deletedTicketsInTeam()), "TEAM_IN_USE")
  if (team._count.ticketSettingsDefault > 0) return apiError(409, DEFAULT_TICKET_TEAM_DELETE_MESSAGE, "DEFAULT_TICKET_TEAM")

  try {
    await prisma.team.delete({ where: teamWhere(ctx, team.id) })
  } catch (err) {
    // An opportunity or ticket moved into it since the check above, or it
    // became the default ticket team
    if (isPrismaError(err, "P2003")) {
      const count = await prisma.opportunity.count({ where: { teamId: team.id, companyId: ctx.companyId } })
      if (count > 0) return apiError(409, teamInUseMessage(count, await deletedInTeam()), "TEAM_IN_USE")
      const tickets = await prisma.ticket.count({ where: { teamId: team.id, companyId: ctx.companyId } })
      if (tickets > 0) return apiError(409, teamTicketsMessage(tickets, await deletedTicketsInTeam()), "TEAM_IN_USE")
      return apiError(409, DEFAULT_TICKET_TEAM_DELETE_MESSAGE, "DEFAULT_TICKET_TEAM")
    }
    const { message, status } = userFacingError(err, "Deleting a team")
    return apiError(status, message)
  }

  return NextResponse.json({ deleted: true })
}
