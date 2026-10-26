import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadOpportunityTimelineEntry, loadViewableOpportunity } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { readJsonObject, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
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
// stored, and a note with no text is refused.
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

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const note = readNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const entry = await prisma.timelineEntry.create({
    data: { companyId: ctx.companyId, opportunityId: opportunity.id, kind: "NOTE", authorId: ctx.userId, body: note.value },
    select: timelineEntrySelect,
  })
  return NextResponse.json(toTimelineEntryResponse(entry))
}
