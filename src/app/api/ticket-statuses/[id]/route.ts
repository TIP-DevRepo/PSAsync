import { NextRequest, NextResponse } from "next/server"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { DELETED_TICKET, ticketStatusWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse, type Refusal } from "@/lib/refusal"
import { ticketStatusSelect } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject, readText } from "@/lib/opportunity-rules"
import {
  isTicketStatusCategory,
  lastStatusMessage,
  STATUS_CATEGORY_FIXED_MESSAGE,
  statusUsedByButtonMessage,
  TICKET_NAME_MAX,
  ticketSettingInUseMessage,
} from "@/lib/ticket-rules"
import { userFacingError } from "@/lib/user-error"

function refusalResponse(refusal: Refusal) {
  return refusal.status === 404 ? notFound() : apiError(refusal.status, refusal.error, refusal.code)
}

// Renames a status. Its category is fixed: a category in the body must be
// the one it already has, otherwise 400 (add a new status instead), so a
// category can never be left empty by a change and no ticket's resolved or
// closed dates ever need to follow one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  let name: string | undefined
  if ("name" in body) {
    const read = readText(body.name, { label: "Status name", max: TICKET_NAME_MAX, required: true })
    if (read.error !== undefined) return apiError(400, read.error)
    name = read.value as string
  }
  if ("category" in body && !isTicketStatusCategory(body.category)) return apiError(400, "Invalid status category")

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const status = await tx.ticketStatus.findFirst({ where: ticketStatusWhere(ctx, id), select: { id: true, category: true } })
    if (!status) return refuse(404, "Not found")
    if ("category" in body && body.category !== status.category) return refuse(400, STATUS_CATEGORY_FIXED_MESSAGE, "STATUS_CATEGORY_FIXED")
    if (name !== undefined) {
      const duplicate = await tx.ticketStatus.findFirst({
        where: { companyId, id: { not: status.id }, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      })
      if (duplicate) return refuse(400, "A status with this name already exists")
    }
    return tx.ticketStatus.update({ where: ticketStatusWhere(ctx, status.id), data: name !== undefined ? { name } : {}, select: ticketStatusSelect })
  })
  if (isRefusal(result)) return refusalResponse(result)
  return NextResponse.json(result)
}

// Refused while any ticket uses the status (deleted ones too), while an
// action button moves to it, and when it is the last status of its category
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const companyId = ctx.companyId
  try {
    const result = await withTicketSettingsLock(companyId, async (tx) => {
      const status = await tx.ticketStatus.findFirst({ where: ticketStatusWhere(ctx, id), select: { id: true, category: true } })
      if (!status) return refuse(404, "Not found")
      const inUse = await tx.ticket.count({ where: { companyId, statusId: status.id } })
      if (inUse > 0) {
        const deleted = await tx.ticket.count({ where: { companyId, statusId: status.id, ...DELETED_TICKET } })
        return refuse(409, ticketSettingInUseMessage("status", inUse, deleted), "STATUS_IN_USE")
      }
      const button = await tx.actionButton.findFirst({
        where: { companyId, fixedTicketStatusId: status.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { label: true },
      })
      if (button) return refuse(409, statusUsedByButtonMessage(button.label), "STATUS_USED_BY_BUTTON")
      const sameCategory = await tx.ticketStatus.count({ where: { companyId, category: status.category } })
      if (sameCategory <= 1) return refuse(409, lastStatusMessage(status.category), "LAST_STATUS_IN_CATEGORY")
      await tx.ticketStatus.delete({ where: ticketStatusWhere(ctx, status.id) })
      return { deleted: true as const }
    })
    if (isRefusal(result)) return refusalResponse(result)
    return NextResponse.json(result)
  } catch (err) {
    // A ticket moved into the status, or a button was set to it, since the
    // checks above (the database refuses the delete)
    if (isPrismaError(err, "P2003")) return apiError(409, ticketSettingInUseMessage("status", null), "STATUS_IN_USE")
    const { message, status } = userFacingError(err, "Deleting a ticket status")
    return apiError(status, message)
  }
}
