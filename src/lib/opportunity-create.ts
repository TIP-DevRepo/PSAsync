import type { OpportunitySource, OpportunityStageCategory, Prisma, PrismaClient } from "@/generated/prisma"
import { takeOpportunityNumber } from "@/lib/opportunity-number"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { closedAtFor, OPPORTUNITY_TITLE_MAX } from "@/lib/opportunity-rules"
import { initialNoteAuthorId, initialNoteHtml, recordTimelineActions, writeInitialNote, type InitialNote } from "@/lib/timeline"
import { opportunityCreatedAction } from "@/lib/opportunity-timeline"
import { loadDefaultTeamId } from "@/lib/team-defaults"
import { recordAudit } from "@/lib/audit-log"
import { opportunityCreatedAudit } from "@/lib/opportunity-audit"
import { checkPrefixedTitle, fitPrefixedTitle } from "@/lib/record-title"
import { UserError } from "@/lib/user-error"

// Creating an opportunity, shared by POST /api/opportunities (a person) and
// a later branch that creates one automatically (from a sent quote). Every
// opportunity starts with a note: a person's own initial note, or a note
// the system writes for an automatic one. The caller has already checked
// access and every id (assertRefs).

// The initial note rules are shared with tickets (src/lib/timeline.ts)
export { INITIAL_NOTE_REQUIRED_MESSAGE, initialNoteHtml, type InitialNote } from "@/lib/timeline"

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
  // True for a title nobody typed (one made from a quote's title): one
  // that is too long once the client's prefix goes in front is cut to fit
  // instead of refused, so a quote send never fails over it
  fitTitle?: boolean
}

// Creates the opportunity, its "created" timeline and audit entries, and
// the initial note a moment after it (so the note reads first, newest
// first), all in one transaction that also takes the number. The created
// entries and the note are by the person, or by the system (no author) for
// a system note.
export async function createOpportunity(db: Pick<PrismaClient, "$transaction">, input: NewOpportunity, now = new Date()) {
  const noteHtml = initialNoteHtml(input.initialNote)
  return db.$transaction((tx) => createOpportunityIn(tx, input, noteHtml, now))
}

// The same inside a transaction the caller already runs, for an
// opportunity created as part of another change (a quote being sent), so
// the change and the opportunity are saved together or not at all
export async function createOpportunityInTransaction(tx: Prisma.TransactionClient, input: NewOpportunity, now = new Date()) {
  return createOpportunityIn(tx, input, initialNoteHtml(input.initialNote), now)
}

async function createOpportunityIn(tx: Prisma.TransactionClient, input: NewOpportunity, noteHtml: string, now: Date) {
  const authorId = initialNoteAuthorId(input.initialNote)
  const teamId = input.teamId ?? (await loadDefaultTeamId(input.companyId, tx))
  if (!teamId) throw new Error("The company has no General team; run ensureTeamDefaults first")
  const number = await takeOpportunityNumber(tx, input.companyId, now)
  // The client's prefix goes in front of the title (src/lib/record-title.ts)
  const client = await tx.client.findFirst({ where: { id: input.clientId, companyId: input.companyId }, select: { prefix: true } })
  // The limit counts the saved title, prefix included
  const title = input.fitTitle
    ? { value: fitPrefixedTitle(input.title, client?.prefix, OPPORTUNITY_TITLE_MAX) }
    : checkPrefixedTitle(input.title, client?.prefix, OPPORTUNITY_TITLE_MAX)
  if (title.error !== undefined) throw new UserError(title.error)
  const created = await tx.opportunity.create({
    data: {
      companyId: input.companyId,
      number,
      title: title.value,
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
  await recordAudit(tx, { companyId: input.companyId, actorId: authorId, entries: [opportunityCreatedAudit(created)], at: now })
  await writeInitialNote(tx, { companyId: input.companyId, subject, authorId, html: noteHtml, createdAt: now })
  return created
}
