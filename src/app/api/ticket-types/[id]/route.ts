import { NextRequest, NextResponse } from "next/server"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { DELETED_TICKET, ticketTypeWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse, type Refusal } from "@/lib/refusal"
import { ticketTypeSelect } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject, readText } from "@/lib/opportunity-rules"
import { lastOfKindMessage, TICKET_NAME_MAX, ticketSettingInUseMessage } from "@/lib/ticket-rules"
import { userFacingError } from "@/lib/user-error"

function refusalResponse(refusal: Refusal) {
  return refusal.status === 404 ? notFound() : apiError(refusal.status, refusal.error, refusal.code)
}

// Renames a type. Names are unique, ignoring case.
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
  const name = readText(body.name, { label: "Type name", max: TICKET_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const type = await tx.ticketType.findFirst({ where: ticketTypeWhere(ctx, id), select: { id: true } })
    if (!type) return refuse(404, "Not found")
    const duplicate = await tx.ticketType.findFirst({
      where: { companyId, id: { not: type.id }, name: { equals: name.value as string, mode: "insensitive" } },
      select: { id: true },
    })
    if (duplicate) return refuse(400, "A type with this name already exists")
    return tx.ticketType.update({ where: ticketTypeWhere(ctx, type.id), data: { name: name.value as string }, select: ticketTypeSelect })
  })
  if (isRefusal(result)) return refusalResponse(result)
  return NextResponse.json(result)
}

// Refused while any ticket uses the type (deleted ones too: their rows are
// kept, so they still hold it), and for the company's last type
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
      const type = await tx.ticketType.findFirst({ where: ticketTypeWhere(ctx, id), select: { id: true } })
      if (!type) return refuse(404, "Not found")
      const inUse = await tx.ticket.count({ where: { companyId, typeId: type.id } })
      if (inUse > 0) {
        const deleted = await tx.ticket.count({ where: { companyId, typeId: type.id, ...DELETED_TICKET } })
        return refuse(409, ticketSettingInUseMessage("type", inUse, deleted), "TYPE_IN_USE")
      }
      if ((await tx.ticketType.count({ where: { companyId } })) <= 1) return refuse(409, lastOfKindMessage("type"), "LAST_TYPE")
      await tx.ticketType.delete({ where: ticketTypeWhere(ctx, type.id) })
      return { deleted: true as const }
    })
    if (isRefusal(result)) return refusalResponse(result)
    return NextResponse.json(result)
  } catch (err) {
    // A ticket took the type since the count above (the database refuses the delete)
    if (isPrismaError(err, "P2003")) return apiError(409, ticketSettingInUseMessage("type", null), "TYPE_IN_USE")
    const { message, status } = userFacingError(err, "Deleting a ticket type")
    return apiError(status, message)
  }
}
