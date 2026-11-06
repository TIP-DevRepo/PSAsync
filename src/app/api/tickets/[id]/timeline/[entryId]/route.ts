import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadTicketTimelineEntry, ticketTimelineEntryWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import { noteChangeRefusal, readNoteBody, timelineEntrySelect, toTimelineEntryResponse } from "@/lib/timeline"
import { recordAudit } from "@/lib/audit-log"
import { ticketNoteAudit } from "@/lib/ticket-audit"

// Who may change an entry: only a NOTE, and only its own author (Global
// Admin included; noteChangeRefusal, the opportunity rule). ACTION and
// EMAIL entries are never edited or deleted. Checked after the entry is
// found, so another ticket's or company's entry is a 404 first.
function refusal(entry: { kind: string; authorId: string | null }, userId: string) {
  const reason = noteChangeRefusal(entry, userId)
  return reason ? apiError(403, reason, "FORBIDDEN") : null
}

// Edits the author's own note: a new sanitized body and editedAt. The audit
// log keeps the text before and after (nothing when the text is the same).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.edit",
    message: "You do not have permission to edit tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id, entryId } = await params
  const entry = await loadTicketTimelineEntry(ctx, id, entryId)
  if (!entry?.ticket) return notFound()
  const record = entry.ticket
  const refused = refusal(entry, ctx.userId)
  if (refused) return refused

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const note = readNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.timelineEntry.findFirstOrThrow({ where: ticketTimelineEntryWhere(ctx, id, entry.id), select: { body: true } })
    const updated = await tx.timelineEntry.update({
      where: ticketTimelineEntryWhere(ctx, id, entry.id),
      data: { body: note.value, editedAt: new Date() },
      select: timelineEntrySelect,
    })
    if (before.body !== note.value) {
      await recordAudit(tx, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        entries: [ticketNoteAudit(record, "edited", { entryId: entry.id, before: before.body, after: note.value })],
      })
    }
    return updated
  })
  return NextResponse.json(toTimelineEntryResponse(saved))
}

// Deletes the author's own note. The audit log keeps the text that was removed.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.edit",
    message: "You do not have permission to edit tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id, entryId } = await params
  const entry = await loadTicketTimelineEntry(ctx, id, entryId)
  if (!entry?.ticket) return notFound()
  const record = entry.ticket
  const refused = refusal(entry, ctx.userId)
  if (refused) return refused

  await prisma.$transaction(async (tx) => {
    const removed = await tx.timelineEntry.delete({ where: ticketTimelineEntryWhere(ctx, id, entry.id), select: { id: true, body: true } })
    await recordAudit(tx, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      entries: [ticketNoteAudit(record, "deleted", { entryId: removed.id, before: removed.body })],
    })
  })
  return NextResponse.json({ deleted: true })
}
