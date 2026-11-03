import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { isPrismaError, readJsonObject, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import { checkActionButton, mergeButtonPatch, type ActionButtonFields } from "@/lib/action-button-rules"
import { actionButtonSelect, ensureActionButtonDefaults, LAST_BUTTON_MESSAGE, withActionButtonsLock } from "@/lib/action-buttons"
import { isRefusal, refuse } from "@/lib/opportunity-defaults"
import { isAvailableActionKind } from "@/lib/timeline-buttons"

const ADMIN_RULE = {
  permission: "settingsSections.actionButtons",
  message: "You do not have permission to manage action buttons",
}

const actionButtonWhere = (companyId: string, id: string) => ({ id, companyId })

// Changes any of a button's fields. The stored button with the request's
// fields laid over it is checked as a whole (checkActionButton), so a kind
// change that leaves a stage rule behind is refused rather than half saved.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(ADMIN_RULE)
  if (response) return response

  await ensureActionButtonDefaults(ctx.companyId)

  const { id } = await params
  const stored = await prisma.actionButton.findFirst({
    where: actionButtonWhere(ctx.companyId, id),
    select: {
      label: true,
      icon: true,
      color: true,
      forOpportunities: true,
      forTickets: true,
      kind: true,
      stageMode: true,
      fixedStageId: true,
      noteMode: true,
      isHidden: true,
    },
  })
  if (!stored) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const checked = checkActionButton(mergeButtonPatch(stored as ActionButtonFields, body))
  if (checked.error !== undefined) return apiError(400, checked.error)
  const invalid = await assertRefs(ctx, { opportunityStageId: checked.value.fixedStageId })
  if (invalid) return invalid

  try {
    const saved = await prisma.actionButton.update({
      where: actionButtonWhere(ctx.companyId, id),
      data: checked.value,
      select: actionButtonSelect,
    })
    return NextResponse.json({ ...saved, available: isAvailableActionKind(saved.kind) })
  } catch (err) {
    // The fixed stage was deleted since assertRefs checked it, or the
    // button was deleted since it was read
    if (isPrismaError(err, "P2003")) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
    if (isPrismaError(err, "P2025")) return notFound()
    const { message, status } = userFacingError(err, "Saving an action button")
    return apiError(status, message)
  }
}

// Removes a button. Entries it was used for keep its label. The company's
// last button can't be deleted (409), so its defaults never come back; it
// can be hidden instead.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(ADMIN_RULE)
  if (response) return response

  await ensureActionButtonDefaults(ctx.companyId)

  const { id } = await params
  const companyId = ctx.companyId
  const result = await withActionButtonsLock(companyId, async (tx) => {
    const button = await tx.actionButton.findFirst({ where: actionButtonWhere(companyId, id), select: { id: true } })
    if (!button) return refuse(404, "Not found")
    if ((await tx.actionButton.count({ where: { companyId } })) <= 1) return refuse(409, LAST_BUTTON_MESSAGE, "LAST_BUTTON")
    await tx.actionButton.delete({ where: actionButtonWhere(companyId, button.id) })
    return { deleted: true as const }
  })

  if (isRefusal(result)) return result.status === 404 ? notFound() : apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
