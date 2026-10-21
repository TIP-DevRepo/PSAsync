import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, isEnumValue, notFound, requireAccess } from "@/lib/api-access"
import { opportunityStageWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults, lockOpportunitySettings } from "@/lib/opportunity-defaults"
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
  stageInUseMessage,
  WIN_PROBABILITY_MESSAGE,
} from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import { OpportunityStageCategory, type Prisma } from "@/generated/prisma"

// What a stage write's transaction decided: the saved stage, or a refusal
type Outcome<T> = { ok: T } | { status: 400 | 404 | 409; error: string; code?: string }

function answer<T>(outcome: Outcome<T>) {
  if ("ok" in outcome) return NextResponse.json(outcome.ok)
  return outcome.status === 404 ? notFound() : apiError(outcome.status, outcome.error, outcome.code)
}

// Changes the name, category, or win probability. A category change is
// refused when the stage is the last of its old category, or when it is the
// stage a sent quote moves to and would stop being OPEN.
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
  if ("name" in body) {
    const name = readText(body.name, { label: "Stage name", max: OPPORTUNITY_NAME_MAX, required: true })
    if (name.error !== undefined) return apiError(400, name.error)
    data.name = name.value as string
  }
  if ("category" in body) {
    if (!isEnumValue(OpportunityStageCategory, body.category)) return apiError(400, "Invalid stage category")
    data.category = body.category
  }
  if ("winProbability" in body) {
    if (!isWinProbability(body.winProbability)) return apiError(400, WIN_PROBABILITY_MESSAGE)
    data.winProbability = body.winProbability
  }

  const companyId = ctx.companyId
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome<unknown>> => {
    const settings = await lockOpportunitySettings(tx, companyId)
    const stage = await tx.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, id), select: { id: true, category: true } })
    if (!stage) return { status: 404, error: "Not found" }

    if (typeof data.name === "string") {
      const duplicate = await tx.opportunityStage.findFirst({
        where: { companyId, id: { not: stage.id }, name: { equals: data.name, mode: "insensitive" } },
        select: { id: true },
      })
      if (duplicate) return { status: 400, error: "A stage with this name already exists" }
    }

    if (data.category !== undefined && data.category !== stage.category) {
      const sameCategory = await tx.opportunityStage.count({ where: { companyId, category: stage.category } })
      if (sameCategory <= 1) return { status: 409, error: lastStageMessage(stage.category, "moved"), code: "LAST_STAGE_IN_CATEGORY" }
      if (stage.id === settings.quoteSentStageId && data.category !== "OPEN") {
        return { status: 409, error: QUOTE_SENT_STAGE_CATEGORY_MESSAGE, code: "QUOTE_SENT_STAGE" }
      }
    }

    const saved = await tx.opportunityStage.update({ where: opportunityStageWhere(ctx, stage.id), data, select: opportunityStageSelect })
    return { ok: saved }
  })

  return answer(outcome)
}

// Refused while any opportunity uses the stage, when it is the last stage of
// its category, or when it is the stage a sent quote moves to
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
    const outcome = await prisma.$transaction(async (tx): Promise<Outcome<{ deleted: true }>> => {
      const settings = await lockOpportunitySettings(tx, companyId)
      const stage = await tx.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, id), select: { id: true, category: true } })
      if (!stage) return { status: 404, error: "Not found" }

      const inUse = await tx.opportunity.count({ where: { companyId, stageId: stage.id } })
      if (inUse > 0) return { status: 409, error: stageInUseMessage(inUse), code: "STAGE_IN_USE" }
      const sameCategory = await tx.opportunityStage.count({ where: { companyId, category: stage.category } })
      if (sameCategory <= 1) return { status: 409, error: lastStageMessage(stage.category, "deleted"), code: "LAST_STAGE_IN_CATEGORY" }
      if (stage.id === settings.quoteSentStageId) return { status: 409, error: QUOTE_SENT_STAGE_DELETE_MESSAGE, code: "QUOTE_SENT_STAGE" }

      await tx.opportunityStage.delete({ where: opportunityStageWhere(ctx, stage.id) })
      return { ok: { deleted: true } }
    })
    return answer(outcome)
  } catch (err) {
    // An opportunity moved into the stage since the count above (the
    // database refuses the delete)
    if (isPrismaError(err, "P2003")) return apiError(409, stageInUseMessage(null), "STAGE_IN_USE")
    const { message, status } = userFacingError(err, "Deleting an opportunity stage")
    return apiError(status, message)
  }
}
