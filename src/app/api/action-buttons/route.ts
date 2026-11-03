import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { isPrismaError, readJsonObject, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import { checkActionButton } from "@/lib/action-button-rules"
import {
  ACTION_BUTTON_ORDER,
  actionButtonSelect,
  ensureActionButtonDefaults,
  INVALID_RECORD_TYPE_MESSAGE,
  loadRecordButtons,
  readRecordType,
} from "@/lib/action-buttons"
import { isAvailableActionKind } from "@/lib/timeline-buttons"

const ADMIN_RULE = {
  permission: "settingsSections.actionButtons",
  message: "You do not have permission to manage action buttons",
}

const RECORD_RULE = {
  permission: ["pages.opportunities", "settingsSections.actionButtons"],
  message: "You do not have permission to view opportunities",
}

// Two lists:
//   ?for=opportunity: the buttons an opportunity shows (not hidden, set to
//     show there, and of a kind whose feature exists), in order, as the
//     action bar's definitions. Anyone who can open opportunities reads
//     them, as can Action Buttons admins.
//   no ?for: every button, hidden ones and kinds that aren't available yet
//     included, for Settings > Action Buttons (settingsSections.actionButtons).
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess(req.nextUrl.searchParams.get("for") === null ? ADMIN_RULE : RECORD_RULE)
  if (response) return response

  const forParam = req.nextUrl.searchParams.get("for")

  await ensureActionButtonDefaults(ctx.companyId)

  if (forParam !== null) {
    const recordType = readRecordType(forParam)
    if (!recordType) return apiError(400, INVALID_RECORD_TYPE_MESSAGE)
    return NextResponse.json(await loadRecordButtons(ctx.companyId, recordType))
  }

  const buttons = await prisma.actionButton.findMany({
    where: { companyId: ctx.companyId },
    orderBy: ACTION_BUTTON_ORDER,
    select: actionButtonSelect,
  })
  return NextResponse.json(buttons.map((b) => ({ ...b, available: isAvailableActionKind(b.kind) })))
}

// Adds a button at the end of the list
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess(ADMIN_RULE)
  if (response) return response

  await ensureActionButtonDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const checked = checkActionButton({
    forOpportunities: true,
    forTickets: false,
    stageMode: "NONE",
    fixedStageId: null,
    noteMode: "REQUIRED",
    isHidden: false,
    ...body,
  })
  if (checked.error !== undefined) return apiError(400, checked.error)
  const invalid = await assertRefs(ctx, { opportunityStageId: checked.value.fixedStageId })
  if (invalid) return invalid

  const companyId = ctx.companyId
  const last = await prisma.actionButton.findFirst({ where: { companyId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
  try {
    const created = await prisma.actionButton.create({
      data: { ...checked.value, companyId, sortOrder: (last?.sortOrder ?? -1) + 1 },
      select: actionButtonSelect,
    })
    return NextResponse.json({ ...created, available: isAvailableActionKind(created.kind) }, { status: 201 })
  } catch (err) {
    // The fixed stage was deleted since assertRefs checked it
    if (isPrismaError(err, "P2003")) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
    const { message, status } = userFacingError(err, "Creating an action button")
    return apiError(status, message)
  }
}
