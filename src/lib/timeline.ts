import type { Prisma } from "@/generated/prisma"
import { termsForStorage, termsToDisplayHtml } from "@/lib/sanitize-terms"
import type { TimelineAction } from "@/lib/timeline-actions"

// Server side helpers every timeline uses (opportunities now, tickets
// later): recording ACTION entries inside the caller's transaction, reading
// and writing NOTE bodies through the rich text sanitizer, and reading a
// page of entries newest first. No database client of its own: callers pass
// theirs, or the transaction the change runs in.

export const TIMELINE_PAGE_SIZE = 25
// Characters of HTML a note may send, before sanitizing
export const TIMELINE_NOTE_MAX = 50000

export const NOTE_EMPTY_MESSAGE = "A note can't be empty"
export const NOTE_TOO_LONG_MESSAGE = `A note must be ${TIMELINE_NOTE_MAX} characters or fewer`
export const ONLY_NOTES_EDITABLE_MESSAGE = "Only notes can be edited or deleted"
export const OWN_NOTES_ONLY_MESSAGE = "You can only edit or delete your own notes"
export const INVALID_CURSOR_MESSAGE = "Invalid cursor"

// The record an entry belongs to. Tickets add { ticketId } later.
export type TimelineSubject = { opportunityId: string }

type TimelineDb = Pick<Prisma.TransactionClient, "timelineEntry">

// Writes ACTION entries, all at the same time, inside the transaction that
// made the change, so a change and its entries are saved together or not at
// all. Nothing when there is nothing to record. authorId is the user who
// made the change, or null for the system.
export async function recordTimelineActions(
  db: TimelineDb,
  opts: { companyId: string; authorId: string | null; subject: TimelineSubject; actions: TimelineAction[]; at?: Date }
): Promise<void> {
  if (opts.actions.length === 0) return
  const createdAt = opts.at ?? new Date()
  await db.timelineEntry.createMany({
    data: opts.actions.map((a) => ({
      companyId: opts.companyId,
      ...opts.subject,
      kind: "ACTION" as const,
      authorId: opts.authorId,
      action: a.action,
      data: a.data as unknown as Prisma.InputJsonObject,
      createdAt,
    })),
  })
}

// True when HTML holds no text at all once its tags are removed (the editor
// sends "<p></p>" for an empty note)
export function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
      .trim() === ""
  )
}

// A note body from a request, sanitized for storage with the same sanitizer
// as quote terms (src/lib/sanitize-terms.ts), or why it can't be saved
export function readNoteBody(value: unknown): { value: string; error?: undefined } | { error: string; value?: undefined } {
  if (typeof value !== "string") return { error: NOTE_EMPTY_MESSAGE }
  if (value.length > TIMELINE_NOTE_MAX) return { error: NOTE_TOO_LONG_MESSAGE }
  const html = termsForStorage(value)
  if (!html || isBlankHtml(html)) return { error: NOTE_EMPTY_MESSAGE }
  return { value: html }
}

// What every timeline route returns for an entry. Authors are names only.
export const timelineEntrySelect = {
  id: true,
  kind: true,
  action: true,
  data: true,
  body: true,
  editedAt: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.TimelineEntrySelect

// A note's body is sanitized again on the way out, like quote terms
export function toTimelineEntryResponse<T extends { body: string | null }>(row: T): T {
  return row.body === null ? row : { ...row, body: termsToDisplayHtml(row.body) }
}

// One page of entries, newest first (ties by id, so a page boundary never
// skips or repeats one). cursor is the last entry of the previous page,
// already checked to belong to the same record. nextCursor is null on the
// last page.
export async function readTimelinePage(
  db: TimelineDb,
  where: Prisma.TimelineEntryWhereInput,
  cursor: string | null
) {
  const rows = await db.timelineEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TIMELINE_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: timelineEntrySelect,
  })
  const more = rows.length > TIMELINE_PAGE_SIZE
  const entries = (more ? rows.slice(0, TIMELINE_PAGE_SIZE) : rows).map(toTimelineEntryResponse)
  return { entries, nextCursor: more ? entries[entries.length - 1].id : null }
}
