import type { OpportunitySource, OpportunityStageCategory, PrismaClient } from "@/generated/prisma"
import { takeOpportunityNumber } from "@/lib/opportunity-number"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { closedAtFor } from "@/lib/opportunity-rules"
import { NOTE_EMPTY_MESSAGE, readNoteBody, recordTimelineActions } from "@/lib/timeline"
import { opportunityCreatedAction } from "@/lib/opportunity-timeline"
import { UserError } from "@/lib/user-error"
import { loadDefaultTeamId } from "@/lib/team-defaults"

// Creating an opportunity, shared by POST /api/opportunities (a person) and
// a later branch that creates one automatically (from a sent quote). Every
// opportunity starts with a note: a person's own initial note, or a note
// the system writes for an automatic one. The caller has already checked
// access and every id (assertRefs).

export const INITIAL_NOTE_REQUIRED_MESSAGE = "An initial note is required"

// The first note on the timeline. html is sanitized here; one that has no
// text after sanitizing is refused.
export type InitialNote = { by: "person"; userId: string; html: string } | { by: "system"; html: string }

export interface NewOpportunity {
  companyId: string
  // The user the opportunity is recorded as created by (for an automatic
  // one, whoever's action caused it)
  createdById: string
  title: string
  clientId: string
  contactId: string
  clientLocationId: string | null
  // Null is unassigned, the default for new records. Callers check the
  // owner is a member of the team.
  ownerId: string | null
  // The team the opportunity goes to. Left out or null, the company's
  // General team (callers run ensureTeamDefaults first).
  teamId?: string | null
  stage: { id: string; category: OpportunityStageCategory }
  typeId: string | null
  source: OpportunitySource
  expectedValue: string | null
  expectedCloseDate: Date | null
  initialNote: InitialNote
}

// The sanitized note body, or a UserError (shown to the user as a 400) when
// it is empty or too long
export function initialNoteHtml(note: InitialNote): string {
  const read = readNoteBody(note.html)
  if (read.error !== undefined) throw new UserError(read.error === NOTE_EMPTY_MESSAGE ? INITIAL_NOTE_REQUIRED_MESSAGE : read.error)
  return read.value
}

// Creates the opportunity, its "created" timeline entry, and the initial
// note a moment after it (so the note reads first, newest first), all in
// one transaction that also takes the number. The created entry and the
// note are by the person, or by the system (no author) for a system note.
export async function createOpportunity(db: Pick<PrismaClient, "$transaction">, input: NewOpportunity, now = new Date()) {
  const noteHtml = initialNoteHtml(input.initialNote)
  const authorId = input.initialNote.by === "person" ? input.initialNote.userId : null

  return db.$transaction(async (tx) => {
    const teamId = input.teamId ?? (await loadDefaultTeamId(input.companyId, tx))
    if (!teamId) throw new Error("The company has no General team; run ensureTeamDefaults first")
    const number = await takeOpportunityNumber(tx, input.companyId, now)
    const created = await tx.opportunity.create({
      data: {
        companyId: input.companyId,
        number,
        title: input.title,
        clientId: input.clientId,
        contactId: input.contactId,
        clientLocationId: input.clientLocationId,
        ownerId: input.ownerId,
        teamId,
        stageId: input.stage.id,
        typeId: input.typeId,
        source: input.source,
        expectedValue: input.expectedValue,
        expectedCloseDate: input.expectedCloseDate,
        stageChangedAt: now,
        closedAt: closedAtFor(input.stage.category, now),
        createdById: input.createdById,
      },
      select: opportunityDetailSelect,
    })

    const subject = { opportunityId: created.id }
    await recordTimelineActions(tx, { companyId: input.companyId, authorId, subject, actions: [opportunityCreatedAction(created)], at: now })
    await tx.timelineEntry.create({
      data: { companyId: input.companyId, ...subject, kind: "NOTE", authorId, body: noteHtml, createdAt: new Date(now.getTime() + 1) },
      select: { id: true },
    })
    return created
  })
}
