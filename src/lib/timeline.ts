import type { Prisma } from "@/generated/prisma"
import { termsForStorage, termsToDisplayHtml } from "@/lib/sanitize-terms"
import { isBlankHtml, type TimelineAction } from "@/lib/timeline-actions"
import { UserError } from "@/lib/user-error"

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

// The record an entry belongs to
export type TimelineSubject = { opportunityId: string; ticketId?: undefined } | { ticketId: string; opportunityId?: undefined }

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

// Lives with the action sentences so the note composer can use it too
export { isBlankHtml }

// A note body from a request, sanitized for storage with the same sanitizer
// as quote terms (src/lib/sanitize-terms.ts), or why it can't be saved
export function readNoteBody(value: unknown): { value: string; error?: undefined } | { error: string; value?: undefined } {
  if (typeof value !== "string") return { error: NOTE_EMPTY_MESSAGE }
  if (value.length > TIMELINE_NOTE_MAX) return { error: NOTE_TOO_LONG_MESSAGE }
  const html = termsForStorage(value)
  if (!html || isBlankHtml(html)) return { error: NOTE_EMPTY_MESSAGE }
  return { value: html }
}

// A note body under an action button whose note is optional: empty (left
// out, or no text once sanitized) is null, anything else is read as
// readNoteBody reads it
export function readOptionalNoteBody(value: unknown): { value: string | null; error?: undefined } | { error: string; value?: undefined } {
  if (value === undefined || value === null) return { value: null }
  const read = readNoteBody(value)
  if (read.error === NOTE_EMPTY_MESSAGE) return { value: null }
  return read
}

// ─── Initial notes ──────────────────────────────────────────────────────────

// Every new record (opportunities, tickets) starts with a note: a person's
// own initial note, or a note the system writes for an automatic one
export const INITIAL_NOTE_REQUIRED_MESSAGE = "An initial note is required"

// The first note on the timeline. html is sanitized here; one that has no
// text after sanitizing is refused.
export type InitialNote = { by: "person"; userId: string; html: string } | { by: "system"; html: string }

// The sanitized note body, or a UserError (shown to the user as a 400) when
// it is empty or too long
export function initialNoteHtml(note: InitialNote): string {
  const read = readNoteBody(note.html)
  if (read.error !== undefined) throw new UserError(read.error === NOTE_EMPTY_MESSAGE ? INITIAL_NOTE_REQUIRED_MESSAGE : read.error)
  return read.value
}

// The author of an initial note: the person, or null for the system
export const initialNoteAuthorId = (note: InitialNote) => (note.by === "person" ? note.userId : null)

// Writes the initial note a moment after the record's created entries (so
// it reads first, newest first), inside the record's create transaction
export async function writeInitialNote(
  db: TimelineDb,
  opts: { companyId: string; subject: TimelineSubject; authorId: string | null; html: string; createdAt: Date }
): Promise<void> {
  await db.timelineEntry.create({
    data: { companyId: opts.companyId, ...opts.subject, kind: "NOTE", authorId: opts.authorId, body: opts.html, createdAt: new Date(opts.createdAt.getTime() + 1) },
    select: { id: true },
  })
}

// ─── Changing notes ─────────────────────────────────────────────────────────

// Why a user may not edit or delete an entry, or null when they may: only a
// NOTE, and only its own author (Global Admin included). ACTION and EMAIL
// entries are never edited or deleted.
export function noteChangeRefusal(entry: { kind: string; authorId: string | null }, userId: string): string | null {
  if (entry.kind !== "NOTE") return ONLY_NOTES_EDITABLE_MESSAGE
  if (entry.authorId !== userId) return OWN_NOTES_ONLY_MESSAGE
  return null
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
