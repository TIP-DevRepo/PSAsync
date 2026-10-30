import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadOpportunityTimelineEntry, opportunityTimelineEntryWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { readJsonObject, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import {
  ONLY_NOTES_EDITABLE_MESSAGE,
  OWN_NOTES_ONLY_MESSAGE,
  readNoteBody,
  timelineEntrySelect,
  toTimelineEntryResponse,
} from "@/lib/timeline"
import { recordAudit } from "@/lib/audit-log"
import { opportunityNoteAudit } from "@/lib/opportunity-audit"

// Who may change an entry: only a NOTE, and only its own author (Global
// Admin included). ACTION and EMAIL entries are never edited or deleted.
// Checked after the entry is found, so another opportunity's or company's
// entry is a 404 first.
function refusal(entry: { kind: string; authorId: string | null }, userId: string) {
  if (entry.kind !== "NOTE") return apiError(403, ONLY_NOTES_EDITABLE_MESSAGE, "FORBIDDEN")
  if (entry.authorId !== userId) return apiError(403, OWN_NOTES_ONLY_MESSAGE, "FORBIDDEN")
  return null
}

// Edits the author's own note: a new sanitized body and editedAt. The audit
// log keeps the text before and after (nothing when the text is the same).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id, entryId } = await params
  const entry = await loadOpportunityTimelineEntry(ctx, id, entryId)
  if (!entry?.opportunity) return notFound()
  const record = entry.opportunity
  const refused = refusal(entry, ctx.userId)
  if (refused) return refused

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const note = readNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.timelineEntry.findFirstOrThrow({ where: opportunityTimelineEntryWhere(ctx, id, entry.id), select: { body: true } })
    const updated = await tx.timelineEntry.update({
      where: opportunityTimelineEntryWhere(ctx, id, entry.id),
      data: { body: note.value, editedAt: new Date() },
      select: timelineEntrySelect,
    })
    if (before.body !== note.value) {
      await recordAudit(tx, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        entries: [opportunityNoteAudit(record, "edited", { entryId: entry.id, before: before.body, after: note.value })],
      })
    }
    return updated
  })
  return NextResponse.json(toTimelineEntryResponse(saved))
}

// Deletes the author's own note. Deleted notes can't be restored, but the
// audit log keeps the text that was removed.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id, entryId } = await params
  const entry = await loadOpportunityTimelineEntry(ctx, id, entryId)
  if (!entry?.opportunity) return notFound()
  const record = entry.opportunity
  const refused = refusal(entry, ctx.userId)
  if (refused) return refused

  await prisma.$transaction(async (tx) => {
    const removed = await tx.timelineEntry.delete({ where: opportunityTimelineEntryWhere(ctx, id, entry.id), select: { id: true, body: true } })
    await recordAudit(tx, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      entries: [opportunityNoteAudit(record, "deleted", { entryId: removed.id, before: removed.body })],
    })
  })
  return NextResponse.json({ deleted: true })
}
