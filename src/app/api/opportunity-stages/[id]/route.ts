import { NextRequest, NextResponse } from "next/server"
import { apiError, isEnumValue, notFound, requireAccess } from "@/lib/api-access"
import { DELETED_OPPORTUNITY, opportunityStageWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults, isRefusal, refuse, withOpportunitySettingsLock, type Refusal } from "@/lib/opportunity-defaults"
import { opportunityStageSelect } from "@/lib/opportunity-selects"
import {
  INVALID_BODY_MESSAGE,
  isPrismaError,
  isWinProbability,
  lastStageMessage,
  OPPORTUNITY_NAME_MAX,
  QUOTE_SENT_STAGE_CATEGORY_MESSAGE,
  QUOTE_SENT_STAGE_DELETE_MESSAGE,
  readJsonObject,
  readText,
  stageCategoryClosedAtUpdate,
  stageInUseMessage,
  WIN_PROBABILITY_MESSAGE,
} from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import { stageUsedByButtonMessage } from "@/lib/action-buttons"
import { recordAudit } from "@/lib/audit-log"
import { opportunityClosedDateAudit } from "@/lib/opportunity-audit"
import { OpportunityStageCategory, type Prisma } from "@/generated/prisma"

function refusalResponse(refusal: Refusal) {
  return refusal.status === 404 ? notFound() : apiError(refusal.status, refusal.error, refusal.code)
}

// Changes the name, category, or win probability. A category change is
// refused when the stage is the last of its old category, or when it is the
// stage a sent quote moves to and would stop being OPEN. An accepted one
// sets or clears closedAt on the stage's opportunities in the same
// transaction (stageCategoryClosedAtUpdate), with a closed_date_changed
// audit entry for each opportunity whose closedAt changed. Deleted
// opportunities follow too, so one restored later still matches its stage.
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
  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: Prisma.OpportunityStageUpdateInput = {}
  let name: string | undefined
  let category: OpportunityStageCategory | undefined
  if ("name" in body) {
    const read = readText(body.name, { label: "Stage name", max: OPPORTUNITY_NAME_MAX, required: true })
    if (read.error !== undefined) return apiError(400, read.error)
    name = read.value as string
    data.name = name
  }
  if ("category" in body) {
    if (!isEnumValue(OpportunityStageCategory, body.category)) return apiError(400, "Invalid stage category")
    category = body.category
    data.category = category
  }
  if ("winProbability" in body) {
    if (!isWinProbability(body.winProbability)) return apiError(400, WIN_PROBABILITY_MESSAGE)
    data.winProbability = body.winProbability
  }

  const companyId = ctx.companyId
  const result = await withOpportunitySettingsLock(companyId, async (tx, settings) => {
    const stage = await tx.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, id), select: { id: true, category: true } })
    if (!stage) return refuse(404, "Not found")

    if (name !== undefined) {
      const duplicate = await tx.opportunityStage.findFirst({
        where: { companyId, id: { not: stage.id }, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      })
      if (duplicate) return refuse(400, "A stage with this name already exists")
    }

    if (category !== undefined && category !== stage.category) {
      const sameCategory = await tx.opportunityStage.count({ where: { companyId, category: stage.category } })
      if (sameCategory <= 1) return refuse(409, lastStageMessage(stage.category, "moved"), "LAST_STAGE_IN_CATEGORY")
      if (stage.id === settings.quoteSentStageId && category !== "OPEN") {
        return refuse(409, QUOTE_SENT_STAGE_CATEGORY_MESSAGE, "QUOTE_SENT_STAGE")
      }
    }

    const saved = await tx.opportunityStage.update({ where: opportunityStageWhere(ctx, stage.id), data, select: opportunityStageSelect })

    // The opportunities in the stage follow its category: closed now when
    // it becomes WON or LOST (keeping an earlier close date), open again
    // when it becomes OPEN
    const closedAt = category === undefined ? null : stageCategoryClosedAtUpdate(stage.category, category, new Date())
    if (closedAt) {
      // Deliberately without the not deleted condition (see above)
      const affected = await tx.opportunity.findMany({
        where: { companyId, stageId: stage.id, ...(closedAt.onlyWithoutClosedAt ? { closedAt: null } : { closedAt: { not: null } }) },
        select: { id: true, number: true, title: true, closedAt: true },
      })
      if (affected.length > 0) {
        await tx.opportunity.updateMany({
          where: { companyId, id: { in: affected.map((o) => o.id) } },
          data: { closedAt: closedAt.closedAt },
        })
        await recordAudit(tx, {
          companyId,
          actorId: ctx.userId,
          entries: affected.map((o) => opportunityClosedDateAudit(o, o.closedAt, closedAt.closedAt)),
        })
      }
    }

    return saved
  })

  if (isRefusal(result)) return refusalResponse(result)
  return NextResponse.json(result)
}

// Refused while any opportunity uses the stage, while an action button
// moves to it, when it is the last stage of its category, or when it is the
// stage a sent quote moves to
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
  const companyId = ctx.companyId
  try {
    const result = await withOpportunitySettingsLock(companyId, async (tx, settings) => {
      const stage = await tx.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, id), select: { id: true, category: true } })
      if (!stage) return refuse(404, "Not found")

      // Deleted opportunities count too: their rows are kept, so they still hold the stage
      const inUse = await tx.opportunity.count({ where: { companyId, stageId: stage.id } })
      if (inUse > 0) {
        const deleted = await tx.opportunity.count({ where: { companyId, stageId: stage.id, ...DELETED_OPPORTUNITY } })
        return refuse(409, stageInUseMessage(inUse, deleted), "STAGE_IN_USE")
      }
      const button = await tx.actionButton.findFirst({
        where: { companyId, fixedStageId: stage.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { label: true },
      })
      if (button) return refuse(409, stageUsedByButtonMessage(button.label), "STAGE_USED_BY_BUTTON")
      const sameCategory = await tx.opportunityStage.count({ where: { companyId, category: stage.category } })
      if (sameCategory <= 1) return refuse(409, lastStageMessage(stage.category, "deleted"), "LAST_STAGE_IN_CATEGORY")
      if (stage.id === settings.quoteSentStageId) return refuse(409, QUOTE_SENT_STAGE_DELETE_MESSAGE, "QUOTE_SENT_STAGE")

      await tx.opportunityStage.delete({ where: opportunityStageWhere(ctx, stage.id) })
      return { deleted: true as const }
    })
    if (isRefusal(result)) return refusalResponse(result)
    return NextResponse.json(result)
  } catch (err) {
    // An opportunity moved into the stage, or a button was set to it, since
    // the checks above (the database refuses the delete)
    if (isPrismaError(err, "P2003")) return apiError(409, stageInUseMessage(null), "STAGE_IN_USE")
    const { message, status } = userFacingError(err, "Deleting an opportunity stage")
    return apiError(status, message)
  }
}
