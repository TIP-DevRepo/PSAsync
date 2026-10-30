import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadOpportunityTimelineEntry, loadViewableOpportunity, opportunityTimelineWhere, opportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { readJsonObject, stageChangeData, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import type { NoteStageChange } from "@/lib/timeline-actions"
import type { Prisma } from "@/generated/prisma"
import {
  INVALID_CURSOR_MESSAGE,
  NOTE_EMPTY_MESSAGE,
  readNoteBody,
  readOptionalNoteBody,
  readTimelinePage,
  timelineEntrySelect,
  toTimelineEntryResponse,
} from "@/lib/timeline"
import { readActionRequest } from "@/lib/action-buttons"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { opportunityNoteAudit, opportunityStageAudit } from "@/lib/opportunity-audit"

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

  const page = await readTimelinePage(prisma, opportunityTimelineWhere(ctx, opportunity.id), cursor)
  return NextResponse.json(page)
}

// Adds a note by the signed in user. The body is sanitized before it is
// stored, and a note with no text is refused. An optional stageId moves the
// opportunity to that stage in the same transaction (stageChangeData, the
// rule the opportunity PATCH uses: stageChangedAt, and closedAt set or
// cleared). The move is recorded on the note itself (data.stageChange),
// never as a separate stage_changed entry. Moving to the stage it is
// already in records no change.
//
// An optional actionButtonId names the NOTE button the note was posted
// with (readActionRequest): its stage rule decides the stage (none, the
// one asked for, or its fixed stage), its note rule whether the text may
// be empty, and its label is stored on the entry (data.actionButton). A
// note left empty under an optional button must move the stage, or there
// is nothing to post. The audit log gets the stage change (field_changed)
// and the note (note_added) in the same transaction.
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
  const action = await readActionRequest(ctx, body, "NOTE")
  if (action.response) return action.response
  const { button, stage } = action
  const note = action.noteRequired ? readNoteBody(body.body) : readOptionalNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
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
    // An empty optional note that moves nothing has nothing to say
    if (note.value === null && !stageChange) return null
    const data = {
      ...(stageChange ? { stageChange } : {}),
      ...(button ? { actionButton: { id: button.id, label: button.label } } : {}),
    }
    const created = await tx.timelineEntry.create({
      data: {
        companyId: ctx.companyId,
        opportunityId: opportunity.id,
        kind: "NOTE",
        authorId: ctx.userId,
        body: note.value,
        ...(Object.keys(data).length > 0 ? { data: data as unknown as Prisma.InputJsonObject } : {}),
        createdAt: now,
      },
      select: timelineEntrySelect,
    })
    const audits: AuditEntryInput[] = []
    if (stageChange) audits.push(opportunityStageAudit(opportunity, stageChange.from, stageChange.to))
    if (note.value !== null) audits.push(opportunityNoteAudit(opportunity, "added", { entryId: created.id, after: note.value }))
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: audits, at: now })
    return created
  })
  if (!result) return apiError(400, NOTE_EMPTY_MESSAGE)
  return NextResponse.json(toTimelineEntryResponse(result))
}
