import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadOpportunityTimelineEntry, loadViewableOpportunity, opportunityStageWhere, opportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { readJsonObject, readOptionalId, stageChangeData, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import type { NoteStageChange } from "@/lib/timeline-actions"
import type { Prisma } from "@/generated/prisma"
import { INVALID_CURSOR_MESSAGE, readNoteBody, readTimelinePage, timelineEntrySelect, toTimelineEntryResponse } from "@/lib/timeline"

// The opportunity's timeline, newest first, TIMELINE_PAGE_SIZE at a time.
// ?cursor= is the last entry of the previous page (nextCursor), which must
// be an entry of this opportunity. Note bodies are sanitized on the way out.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const cursor = req.nextUrl.searchParams.get("cursor") || null
  if (cursor && !(await loadOpportunityTimelineEntry(ctx, opportunity.id, cursor))) {
    return apiError(400, INVALID_CURSOR_MESSAGE)
  }

  const page = await readTimelinePage(prisma, { companyId: ctx.companyId, opportunityId: opportunity.id }, cursor)
  return NextResponse.json(page)
}

// Adds a note by the signed in user. The body is sanitized before it is
// stored, and a note with no text is refused. An optional stageId moves the
// opportunity to that stage in the same transaction (stageChangeData, the
// rule the opportunity PATCH uses: stageChangedAt, and closedAt set or
// cleared). The move is recorded on the note itself (data.stageChange),
// never as a separate stage_changed entry. Moving to the stage it is
// already in records no change.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const note = readNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const stageRef = readOptionalId(body.stageId)
  if (stageRef.error !== undefined) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
  const invalid = await assertRefs(ctx, { opportunityStageId: stageRef.value })
  if (invalid) return invalid
  const stage = stageRef.value
    ? await prisma.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, stageRef.value), select: { id: true, name: true, category: true } })
    : null
  if (stageRef.value && !stage) return apiError(400, "Invalid stage", "INVALID_REFERENCE")

  const now = new Date()
  const entry = await prisma.$transaction(async (tx) => {
    let stageChange: NoteStageChange | null = null
    if (stage) {
      const before = await tx.opportunity.findFirstOrThrow({
        where: opportunityWhere(ctx, opportunity.id),
        select: { stage: { select: { id: true, name: true, category: true } } },
      })
      const change = stageChangeData(before.stage, stage, now)
      if ("stageId" in change) {
        await tx.opportunity.update({ where: opportunityWhere(ctx, opportunity.id), data: change })
        stageChange = { from: before.stage, to: stage }
      }
    }
    return tx.timelineEntry.create({
      data: {
        companyId: ctx.companyId,
        opportunityId: opportunity.id,
        kind: "NOTE",
        authorId: ctx.userId,
        body: note.value,
        ...(stageChange ? { data: { stageChange } as unknown as Prisma.InputJsonObject } : {}),
        createdAt: now,
      },
      select: timelineEntrySelect,
    })
  })
  return NextResponse.json(toTimelineEntryResponse(entry))
}
