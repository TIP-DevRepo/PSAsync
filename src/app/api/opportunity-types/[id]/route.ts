import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { opportunityTypeWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { opportunityTypeSelect } from "@/lib/opportunity-selects"
import {
  INVALID_BODY_MESSAGE,
  isPrismaError,
  OPPORTUNITY_NAME_MAX,
  readJsonObject,
  readText,
  typeInUseMessage,
} from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const { id } = await params
  const type = await prisma.opportunityType.findFirst({ where: opportunityTypeWhere(ctx, id), select: { id: true } })
  if (!type) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const name = readText(body.name, { label: "Type name", max: OPPORTUNITY_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)

  const duplicate = await prisma.opportunityType.findFirst({
    where: { companyId: ctx.companyId, id: { not: type.id }, name: { equals: name.value as string, mode: "insensitive" } },
    select: { id: true },
  })
  if (duplicate) return apiError(400, "A type with this name already exists")

  const saved = await prisma.opportunityType.update({
    where: opportunityTypeWhere(ctx, type.id),
    data: { name: name.value as string },
    select: opportunityTypeSelect,
  })

  return NextResponse.json(saved)
}

// Refused while any opportunity uses the type
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const { id } = await params
  const type = await prisma.opportunityType.findFirst({ where: opportunityTypeWhere(ctx, id), select: { id: true } })
  if (!type) return notFound()

  const inUse = await prisma.opportunity.count({ where: { companyId: ctx.companyId, typeId: type.id } })
  if (inUse > 0) return apiError(409, typeInUseMessage(inUse), "TYPE_IN_USE")

  try {
    await prisma.opportunityType.delete({ where: opportunityTypeWhere(ctx, type.id) })
  } catch (err) {
    // An opportunity took the type since the count above (the database
    // refuses the delete)
    if (isPrismaError(err, "P2003")) return apiError(409, typeInUseMessage(null), "TYPE_IN_USE")
    const { message, status } = userFacingError(err, "Deleting an opportunity type")
    return apiError(status, message)
  }

  return NextResponse.json({ deleted: true })
}
