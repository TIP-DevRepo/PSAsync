import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import {
  assertRefs,
  loadClientMainLocationId,
  loadTeamMemberIds,
  mayAssignTicketTo,
  mayUseTicketTeam,
  ticketListWhere,
  ticketPriorityWhere,
  ticketStatusWhere,
  ticketTypeWhere,
} from "@/lib/scoped-loaders"
import { ensureTicketDefaults, loadDefaultTicketTeamId } from "@/lib/ticket-defaults"
import { ticketListSelect, TICKET_PRIORITY_ORDER, TICKET_STATUS_ORDER, TICKET_TYPE_ORDER } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject, readOptionalId, readText } from "@/lib/opportunity-rules"
import {
  ASSIGNEE_NOT_IN_TEAM_MESSAGE,
  CONTACT_NEEDS_CLIENT_MESSAGE,
  isTicketStatusCategory,
  LOCATION_NEEDS_CLIENT_MESSAGE,
  TICKET_SEARCH_MAX,
  TICKET_SELF_ASSIGN_ONLY_MESSAGE,
  TICKET_TEAM_NOT_MEMBER_MESSAGE,
  TICKET_TITLE_MAX,
} from "@/lib/ticket-rules"
import { INITIAL_NOTE_REQUIRED_MESSAGE, initialNoteHtml } from "@/lib/timeline"
import { createTicket } from "@/lib/ticket-create"
import { isNumberCollision, NUMBER_TAKEN_MESSAGE } from "@/lib/record-number"
import { userFacingError } from "@/lib/user-error"
import {
  ACTIVE_CATEGORIES,
  pageCount,
  pageWindow,
  readTicketApiOptions,
  TICKET_PAGE_SIZE,
  ticketColumnFilterWhere,
  ticketListOrderBy,
  ticketSearchWhere,
  ticketStats,
  ticketViewWhere,
} from "@/lib/ticket-list"
import type { Prisma } from "@/generated/prisma"

// One page of the tickets the user may open (ticketVisibilityWhere: their
// own, the unassigned ones in their teams, every one in their teams with
// tickets.viewTeam, or everyone's with tickets.viewAll; never deleted
// ones), TICKET_PAGE_SIZE at a time, newest first unless sorted. Filters:
// teamId, assigneeId (a user id or "unassigned"), statusId, statusCategory
// (OPEN, WAITING, RESOLVED, or CLOSED), priorityId, typeId, clientId, and q
// (title, number, or client name); view (a built in view, src/lib/ticket-
// list.ts; left out, every ticket), the column filters f_<column>, sort and
// dir, and page. Query ids go through assertRefs, and anything else it
// doesn't understand is a 400. Answers { tickets, total, page, pageSize,
// pageCount, stats }: stats are the stat tiles and view counts, for the
// tickets the user can see in the chosen queue, assignee, and client.
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "pages.tickets",
    message: "You do not have permission to view tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const params = req.nextUrl.searchParams
  const teamId = params.get("teamId") || undefined
  const statusId = params.get("statusId") || undefined
  const priorityId = params.get("priorityId") || undefined
  const typeId = params.get("typeId") || undefined
  const clientId = params.get("clientId") || undefined
  const assigneeParam = params.get("assigneeId") || undefined
  const unassigned = assigneeParam === "unassigned"
  const assigneeId = unassigned ? undefined : assigneeParam

  // An assignee may since be deactivated, so any user of the company
  const invalid = await assertRefs(ctx, {
    clientId,
    teamId,
    companyUserId: assigneeId,
    ticketStatusId: statusId,
    ticketPriorityId: priorityId,
    ticketTypeId: typeId,
  })
  if (invalid) return invalid

  const category = params.get("statusCategory") || undefined
  if (category !== undefined && !isTicketStatusCategory(category)) return apiError(400, "Invalid status category")

  const q = params.get("q")?.trim() ?? ""
  if (q.length > TICKET_SEARCH_MAX) return apiError(400, `Search text must be ${TICKET_SEARCH_MAX} characters or fewer`)

  const options = readTicketApiOptions(params)
  if (options.error !== undefined) return apiError(400, options.error)
  const { view, sort, dir, page, filters: columnFilters } = options.value

  // The scope the stat tiles and view counts are worked out in: what the
  // user can see in the chosen queue, assignee, and client
  const scope: Prisma.TicketWhereInput[] = [ticketListWhere(ctx)]
  if (teamId) scope.push({ teamId })
  if (unassigned) scope.push({ assigneeId: null })
  else if (assigneeId) scope.push({ assigneeId })
  if (clientId) scope.push({ clientId })

  const filters: Prisma.TicketWhereInput[] = [...scope]
  if (statusId) filters.push({ statusId })
  if (category) filters.push({ status: { category } })
  if (priorityId) filters.push({ priorityId })
  if (typeId) filters.push({ typeId })
  const search = ticketSearchWhere(q)
  if (search) filters.push(search)
  const viewWhere = view ? ticketViewWhere(view, ctx.userId) : null
  if (viewWhere) filters.push(viewWhere)
  filters.push(...ticketColumnFilterWhere(columnFilters))

  // Reads only, outside any transaction, so they run side by side
  const where = { AND: filters }
  const [tickets, total, groups, statuses, topPriority] = await Promise.all([
    prisma.ticket.findMany({ where, select: ticketListSelect, orderBy: ticketListOrderBy(sort, dir), ...pageWindow(page) }),
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({
      by: ["statusId", "priorityId", "assigneeId"],
      where: { AND: [...scope, { status: { category: { in: [...ACTIVE_CATEGORIES] } } }] },
      _count: { _all: true },
    }),
    prisma.ticketStatus.findMany({ where: { companyId: ctx.companyId }, select: { id: true, category: true } }),
    // The top priority is the last in the company's order
    prisma.ticketPriority.findFirst({ where: { companyId: ctx.companyId }, orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }], select: { id: true, name: true } }),
  ])

  const stats = ticketStats(
    groups.map((g) => ({ statusId: g.statusId, priorityId: g.priorityId, assigneeId: g.assigneeId, count: g._count._all })),
    new Map(statuses.map((s) => [s.id, s.category])),
    topPriority,
    ctx.userId
  )
  return NextResponse.json({ tickets, total, page, pageSize: TICKET_PAGE_SIZE, pageCount: pageCount(total), stats })
}

// Creates a ticket. Required: title and the person's own initialNote
// (checked after sanitizing). Optional:
//   clientId, contactId (a contact of the client), clientLocationId (a
//     location of the client; left out, the client's main location; null
//     or blank, none). A ticket may have no client.
//   teamId: left out, null, or blank is the default ticket team (Ticket
//     Settings, Helpdesk to start), open to every creator; any other team
//     must be one the creator is in, or any with tickets.assign or
//     tickets.viewAll
//   assigneeId: left out, null, or blank is unassigned (round robin may
//     then assign it); a named one follows mayAssignTicketTo and must be a
//     member of the team
//   typeId, priorityId: left out, the first by sortOrder
//   statusId: left out, the first OPEN status
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.create",
    message: "You do not have permission to create tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const title = readText(body.title, { label: "Title", max: TICKET_TITLE_MAX, required: true })
  if (title.error !== undefined) return apiError(400, title.error)
  if (typeof body.initialNote !== "string") return apiError(400, INITIAL_NOTE_REQUIRED_MESSAGE)
  const initialNote = { by: "person" as const, userId: ctx.userId, html: body.initialNote }
  try {
    initialNoteHtml(initialNote)
  } catch (err) {
    const { message, status } = userFacingError(err, "Checking an initial note")
    return apiError(status, message)
  }

  const client = readOptionalId(body.clientId)
  if (client.error !== undefined) return apiError(400, "Invalid client", "INVALID_REFERENCE")
  const contact = readOptionalId(body.contactId)
  if (contact.error !== undefined) return apiError(400, "Invalid contact", "INVALID_REFERENCE")
  if (contact.value && !client.value) return apiError(400, CONTACT_NEEDS_CLIENT_MESSAGE)
  const hasLocation = "clientLocationId" in body
  const location = readOptionalId(body.clientLocationId)
  if (location.error !== undefined) return apiError(400, "Invalid location", "INVALID_REFERENCE")
  if (location.value && !client.value) return apiError(400, LOCATION_NEEDS_CLIENT_MESSAGE)

  const team = readOptionalId(body.teamId)
  if (team.error !== undefined) return apiError(400, "Invalid team", "INVALID_REFERENCE")
  if (team.value) {
    const invalidTeam = await assertRefs(ctx, { teamId: team.value })
    if (invalidTeam) return invalidTeam
  }
  const defaultTeamId = await loadDefaultTicketTeamId(ctx.companyId)
  const teamId = team.value ?? defaultTeamId
  if (!teamId) return apiError(400, "Invalid team", "INVALID_REFERENCE")

  const assignee = readOptionalId(body.assigneeId)
  if (assignee.error !== undefined) return apiError(400, "Invalid user", "INVALID_REFERENCE")
  const assigneeId = assignee.value
  const members = await loadTeamMemberIds(ctx, teamId, [ctx.userId, assigneeId])
  if (teamId !== defaultTeamId && !mayUseTicketTeam(ctx, members.has(ctx.userId))) {
    return apiError(403, TICKET_TEAM_NOT_MEMBER_MESSAGE, "FORBIDDEN")
  }
  if (!mayAssignTicketTo(ctx, assigneeId)) return apiError(403, TICKET_SELF_ASSIGN_ONLY_MESSAGE, "FORBIDDEN")

  const type = readOptionalId(body.typeId)
  if (type.error !== undefined) return apiError(400, "Invalid ticket type", "INVALID_REFERENCE")
  const priority = readOptionalId(body.priorityId)
  if (priority.error !== undefined) return apiError(400, "Invalid priority", "INVALID_REFERENCE")
  const statusRef = readOptionalId(body.statusId)
  if (statusRef.error !== undefined) return apiError(400, "Invalid status", "INVALID_REFERENCE")

  const invalid = await assertRefs(ctx, {
    clientId: client.value,
    // A contact and a location of this client
    contactId: contact.value,
    clientLocationId: location.value,
    userId: assigneeId,
    ticketTypeId: type.value,
    ticketPriorityId: priority.value,
    ticketStatusId: statusRef.value,
  })
  if (invalid) return invalid
  if (assigneeId && !members.has(assigneeId)) return apiError(400, ASSIGNEE_NOT_IN_TEAM_MESSAGE, "ASSIGNEE_NOT_IN_TEAM")

  const clientLocationId = hasLocation ? location.value : client.value ? await loadClientMainLocationId(ctx, client.value) : null

  // The named type, priority, and status, else the first of each (the
  // first OPEN status) in the company's order
  const companyId = ctx.companyId
  const chosenType = await prisma.ticketType.findFirst({
    where: type.value ? ticketTypeWhere(ctx, type.value) : { companyId },
    orderBy: TICKET_TYPE_ORDER,
    select: { id: true },
  })
  const chosenPriority = await prisma.ticketPriority.findFirst({
    where: priority.value ? ticketPriorityWhere(ctx, priority.value) : { companyId },
    orderBy: TICKET_PRIORITY_ORDER,
    select: { id: true },
  })
  const chosenStatus = await prisma.ticketStatus.findFirst({
    where: statusRef.value ? ticketStatusWhere(ctx, statusRef.value) : { companyId, category: "OPEN" },
    orderBy: TICKET_STATUS_ORDER,
    select: { id: true, category: true },
  })
  if (!chosenType || !chosenPriority || !chosenStatus) return apiError(400, "Add a ticket type, priority, and open status in Ticket Settings first")

  try {
    const ticket = await createTicket(prisma, {
      companyId,
      createdById: ctx.userId,
      title: title.value as string,
      clientId: client.value,
      contactId: contact.value,
      clientLocationId,
      teamId,
      assigneeId,
      typeId: chosenType.id,
      priorityId: chosenPriority.id,
      status: chosenStatus,
      source: "MANUAL",
      initialNote,
    })
    return NextResponse.json(ticket)
  } catch (err) {
    if (isNumberCollision(err)) return apiError(409, NUMBER_TAKEN_MESSAGE, "NUMBER_TAKEN")
    const { message, status } = userFacingError(err, "Creating a ticket")
    return apiError(status, message)
  }
}
