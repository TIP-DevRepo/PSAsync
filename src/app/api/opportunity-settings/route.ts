import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs, opportunityStageWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults, isRefusal, refuse, withOpportunitySettingsLock } from "@/lib/opportunity-defaults"
import { numberPrefixProblem } from "@/lib/number-prefix"
import { INVALID_BODY_MESSAGE, QUOTE_SENT_STAGE_OPEN_MESSAGE, readJsonObject, readOptionalId } from "@/lib/opportunity-rules"
import type { Prisma } from "@/generated/prisma"

const settingsSelect = {
  prefix: true,
  quoteSentStageId: true,
  quoteSentStage: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySettingsSelect

// The Opportunities page and Opportunity Settings both read these
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.opportunities", "settingsSections.opportunities"],
    message: "You do not have permission to view opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const settings = await prisma.opportunitySettings.findUnique({ where: { companyId: ctx.companyId }, select: settingsSelect })
  return NextResponse.json(settings)
}

// prefix follows the quote prefix rule, checked only when it changes.
// quoteSentStageId must be an OPEN stage of this company, or null for none.
export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: Prisma.OpportunitySettingsUncheckedUpdateInput = {}
  if ("quoteSentStageId" in body) {
    const stage = readOptionalId(body.quoteSentStageId)
    if (stage.error !== undefined) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
    const invalid = await assertRefs(ctx, { opportunityStageId: stage.value })
    if (invalid) return invalid
    data.quoteSentStageId = stage.value
  }

  const companyId = ctx.companyId
  const result = await withOpportunitySettingsLock(companyId, async (tx, current) => {
    // The prefix becomes part of every new number. Checked only when it
    // changes, the same as the quote prefix.
    if ("prefix" in body && body.prefix !== current.prefix) {
      const problem = numberPrefixProblem(body.prefix, "Opportunity number")
      if (problem) return refuse(400, problem)
      data.prefix = body.prefix as string
    }

    // Checked inside the lock, so a stage can't leave OPEN at the same time
    if (typeof data.quoteSentStageId === "string") {
      const stage = await tx.opportunityStage.findFirst({
        where: opportunityStageWhere(ctx, data.quoteSentStageId),
        select: { category: true },
      })
      if (!stage) return refuse(400, "Invalid stage", "INVALID_REFERENCE")
      if (stage.category !== "OPEN") return refuse(400, QUOTE_SENT_STAGE_OPEN_MESSAGE)
    }

    return tx.opportunitySettings.update({ where: { companyId }, data, select: settingsSelect })
  })

  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
