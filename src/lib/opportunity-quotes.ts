import type { Prisma, PrismaClient } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { loadClientMainLocationId, opportunityListWhere, opportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults, loadDefaultTeamId } from "@/lib/team-defaults"
import { createOpportunityInTransaction, type NewOpportunity } from "@/lib/opportunity-create"
import { recordTimelineActions } from "@/lib/timeline"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { opportunityRecordAudit, opportunityStageAudit, type RecordLinkAuditAction } from "@/lib/opportunity-audit"
import { stageChangeData } from "@/lib/opportunity-rules"
import { STAGE_ORDER } from "@/lib/opportunity-selects"
import { loadOpportunityRelated, type OpportunityRelated } from "@/lib/opportunity-related"
import { expiryDateFromToday, isDateOnly } from "@/lib/quote-expiry"
import type { TimelineAction } from "@/lib/timeline-actions"
import {
  QUOTE_NEEDS_CONTACT_MESSAGES,
  autoOpportunityNote,
  autoOpportunityTeamAndOwner,
  autoOpportunityTitle,
  buttonStageFor,
  createsOpportunity,
  otherQuotesState,
  quoteEventFor,
  quoteEventReason,
  quoteLabel,
  stageForQuoteEvent,
  type QuoteEvent,
  type QuoteStatusName,
  type StageChoice,
} from "@/lib/opportunity-quote-rules"
import { latestQuoteValue, type OpportunityQuoteValue } from "@/lib/opportunity-value"

// Quotes (and sales orders and purchase orders) tied to opportunities, on
// the database side. The rules themselves are pure and live in
// src/lib/opportunity-quote-rules.ts and src/lib/opportunity-value.ts.
//
// Every write here runs inside the caller's transaction, the one that
// makes the change it follows (a quote sent, accepted, declined, expired,
// linked, or deleted), so a failed change never leaves a half moved or half
// linked opportunity. Deleted opportunities are never touched: every read
// of one goes through opportunityWhere, which leaves them out.
//
// The link belongs to the quote family (every version of a quote shares
// its number and is linked to the same opportunity): setting or clearing it
// writes every version, and a new version takes its family's link.

type Tx = Prisma.TransactionClient

const opportunityRefSelect = { id: true, number: true, title: true } satisfies Prisma.OpportunitySelect

// ─── Links ──────────────────────────────────────────────────────────────────

export type LinkedRecordKind = "quote" | "salesOrder" | "purchaseOrder"

const LINK_ACTIONS: Record<LinkedRecordKind, { linked: RecordLinkAuditAction; unlinked: RecordLinkAuditAction }> = {
  quote: { linked: "quote_linked", unlinked: "quote_unlinked" },
  salesOrder: { linked: "sales_order_linked", unlinked: "sales_order_unlinked" },
  purchaseOrder: { linked: "purchase_order_linked", unlinked: "purchase_order_unlinked" },
}

// One link or unlink on the opportunity's timeline and audit log, by the
// actor (null is the system). record.name is the record's number. Nothing
// for an opportunity that is deleted or isn't the company's.
export async function recordRecordLink(
  tx: Tx,
  opts: {
    companyId: string
    actorId: string | null
    opportunityId: string
    kind: LinkedRecordKind
    change: "linked" | "unlinked"
    record: { id: string; name: string }
    // The link went because the record was deleted
    deleted?: boolean
    at?: Date
  }
): Promise<void> {
  const opportunity = await tx.opportunity.findFirst({ where: opportunityWhere(opts, opts.opportunityId), select: opportunityRefSelect })
  if (!opportunity) return
  const action = LINK_ACTIONS[opts.kind][opts.change]
  const record = { id: opts.record.id, name: opts.record.name }
  const at = opts.at ?? new Date()
  await recordTimelineActions(tx, {
    companyId: opts.companyId,
    authorId: opts.actorId,
    subject: { opportunityId: opportunity.id },
    actions: [{ action, data: opts.deleted ? { record, deleted: true } : { record } } as TimelineAction],
    at,
  })
  await recordAudit(tx, { companyId: opts.companyId, actorId: opts.actorId, entries: [opportunityRecordAudit(opportunity, action, record)], at })
}

// Points every version of a quote at an opportunity (or none) and records
// the unlink from the old one and the link to the new one. Nothing when it
// stays the same. The caller has checked the new opportunity
// (assertRefs quoteOpportunityId).
export async function setQuoteFamilyOpportunity(
  tx: Tx,
  opts: { companyId: string; actorId: string | null; quoteNumber: string; from: string | null; to: string | null }
): Promise<void> {
  if (opts.from === opts.to) return
  const family = await tx.quote.findFirst({ where: { companyId: opts.companyId, quoteNumber: opts.quoteNumber }, orderBy: { version: "asc" }, select: { id: true } })
  if (!family) return
  await tx.quote.updateMany({ where: { companyId: opts.companyId, quoteNumber: opts.quoteNumber }, data: { opportunityId: opts.to } })
  const record = { id: family.id, name: opts.quoteNumber }
  const at = new Date()
  if (opts.from) await recordRecordLink(tx, { ...opts, opportunityId: opts.from, kind: "quote", change: "unlinked", record, at })
  if (opts.to) await recordRecordLink(tx, { ...opts, opportunityId: opts.to, kind: "quote", change: "linked", record, at })
}

// ─── Quote events ───────────────────────────────────────────────────────────

const stageSelect = { id: true, name: true, category: true } satisfies Prisma.OpportunityStageSelect

// The stages events move to: the company's quote sent stage (only while it
// is OPEN), and the first WON and first LOST stages in the company's order
// One query at a time: a transaction's connection runs one at a time anyway
async function eventTargets(tx: Tx, companyId: string) {
  const settings = await tx.opportunitySettings.findUnique({ where: { companyId }, select: { quoteSentStage: { select: stageSelect } } })
  const firstWon = await tx.opportunityStage.findFirst({ where: { companyId, category: "WON" }, orderBy: STAGE_ORDER, select: stageSelect })
  const firstLost = await tx.opportunityStage.findFirst({ where: { companyId, category: "LOST" }, orderBy: STAGE_ORDER, select: stageSelect })
  const sent = settings?.quoteSentStage?.category === "OPEN" ? settings.quoteSentStage : null
  return { sent, firstWon, firstLost }
}

export interface QuoteEventResult {
  opportunityId: string
  // The stage it moved to, or null when it stayed
  movedTo: StageChoice | null
}

// Records a quote event on the quote's opportunity (timeline and audit log)
// and moves its stage by the event's rule (stageForQuoteEvent): through
// stageChangeData, the same write a manual move makes, with a
// stage_changed entry that says which quote event moved it and a
// field_changed audit entry. actorId is the user whose action it was, or
// null for the customer portal and the system. Nothing for a quote with no
// opportunity, or one whose opportunity is deleted.
export async function applyQuoteEvent(
  tx: Tx,
  opts: { companyId: string; quoteId: string; event: QuoteEvent; actorId: string | null; now?: Date }
): Promise<QuoteEventResult | null> {
  const quote = await tx.quote.findFirst({
    where: { id: opts.quoteId, companyId: opts.companyId },
    select: { id: true, quoteNumber: true, version: true, opportunityId: true },
  })
  if (!quote?.opportunityId) return null
  const opportunity = await tx.opportunity.findFirst({
    where: opportunityWhere(opts, quote.opportunityId),
    select: { ...opportunityRefSelect, stage: { select: stageSelect } },
  })
  if (!opportunity) return null

  const declining = opts.event === "declined" || opts.event === "expired"
  const others = declining
    ? otherQuotesState(
        await tx.quote.findMany({
          where: { companyId: opts.companyId, opportunityId: opportunity.id },
          select: { id: true, quoteNumber: true, version: true, status: true, isActive: true },
        }),
        quote
      )
    : { open: false, accepted: false }
  const target = stageForQuoteEvent(opts.event, opportunity.stage, await eventTargets(tx, opts.companyId), others)

  const now = opts.now ?? new Date()
  const label = quoteLabel(quote)
  const record = { id: quote.id, name: label }
  const eventAction = `quote_${opts.event}` as const
  const actions: TimelineAction[] = [{ action: eventAction, data: { record } }]
  const audits: AuditEntryInput[] = [opportunityRecordAudit(opportunity, eventAction, record)]
  const move = target ? await moveStage(tx, opts, opportunity, target, quoteEventReason(opts.event, label), now) : null
  if (move) {
    actions.push(move.action)
    audits.push(move.audit)
  }
  await recordTimelineActions(tx, { companyId: opts.companyId, authorId: opts.actorId, subject: { opportunityId: opportunity.id }, actions, at: now })
  await recordAudit(tx, { companyId: opts.companyId, actorId: opts.actorId, entries: audits, at: now })
  return { opportunityId: opportunity.id, movedTo: move ? target : null }
}

// Moves an opportunity to a stage for a quote, through stageChangeData (the
// write a manual move makes: stageChangedAt, and closedAt set into WON or
// LOST, cleared into OPEN), as one conditional write on the stage it was
// read in, so a move another request made in the meantime is never
// overwritten. Returns the stage_changed action (with the reason) and the
// field_changed audit entry for the caller to record, or null when nothing
// moved.
async function moveStage(
  tx: Tx,
  scope: { companyId: string },
  opportunity: { id: string; number: string; title: string; stage: StageChoice },
  target: StageChoice,
  reason: string,
  now: Date
): Promise<{ action: TimelineAction; audit: AuditEntryInput } | null> {
  if (target.id === opportunity.stage.id) return null
  const { count } = await tx.opportunity.updateMany({
    where: { ...opportunityWhere(scope, opportunity.id), stageId: opportunity.stage.id },
    data: stageChangeData(opportunity.stage, target, now),
  })
  if (count !== 1) return null
  const ref = (s: StageChoice) => ({ id: s.id, name: s.name })
  return {
    action: { action: "stage_changed", data: { from: ref(opportunity.stage), to: ref(target), reason } },
    audit: opportunityStageAudit(opportunity, opportunity.stage, target),
  }
}

// The Create opportunity button: the new opportunity (created at the quote
// sent stage) moves to the stage the quote's status calls for
// (buttonStageFor: Accepted to the first WON stage, Declined or Expired to
// the first LOST stage, Sent or Viewed stays at the quote sent stage), with
// a stage_changed entry and an audit entry. No quote event is recorded: the
// quote's status doesn't change.
export async function moveToQuoteStatusStage(
  tx: Tx,
  opts: { companyId: string; opportunityId: string; quote: { quoteNumber: string; version: number; status: QuoteStatusName }; actorId: string | null }
): Promise<StageChoice | null> {
  const opportunity = await tx.opportunity.findFirst({
    where: opportunityWhere(opts, opts.opportunityId),
    select: { ...opportunityRefSelect, stage: { select: stageSelect } },
  })
  if (!opportunity) return null
  const { target: kind, event } = buttonStageFor(opts.quote.status)
  const targets = await eventTargets(tx, opts.companyId)
  const target = kind === "won" ? targets.firstWon : kind === "lost" ? targets.firstLost : null
  if (!target) return null
  const now = new Date()
  const move = await moveStage(tx, opts, opportunity, target, quoteEventReason(event, quoteLabel(opts.quote)), now)
  if (!move) return null
  const subject = { opportunityId: opportunity.id }
  await recordTimelineActions(tx, { companyId: opts.companyId, authorId: opts.actorId, subject, actions: [move.action], at: now })
  await recordAudit(tx, { companyId: opts.companyId, actorId: opts.actorId, entries: [move.audit], at: now })
  return target
}

// ─── The automatic opportunity ──────────────────────────────────────────────

// Everything an automatic opportunity needs, worked out before the
// transaction that creates it (and before any email goes out), so a quote
// that can't have one is refused while nothing has happened yet
export interface AutoOpportunityPlan {
  input: Omit<NewOpportunity, "createdById">
  quoteOwnerId: string
}

export type AutoPlanResult = { plan: AutoOpportunityPlan | null; error?: undefined } | { error: string; plan?: undefined }

// The expected close date: the quote's Valid until date, as a date only
// value (a date input's midnight UTC is kept; a stored time becomes its
// calendar date in the portal's time zone)
function closeDateFrom(expiresAt: Date | null): Date | null {
  if (!expiresAt) return null
  return isDateOnly(expiresAt) ? expiresAt : expiryDateFromToday(0, expiresAt)
}

// The opportunity a quote gets (plan null when the quote already has one):
// its client, contact, and the client's main location, the owner's first
// team by sortOrder (else General) with the owner when they are in it, the
// company's quote sent stage (else the first OPEN stage), source QUOTE, the
// Valid until date as the expected close date, and a system written note.
// A quote without a contact is refused, since an opportunity needs one.
// how is what creates it: a send, an acceptance, or the Create opportunity
// button (it picks the note and the refusal's wording).
export async function planAutoOpportunity(companyId: string, quoteId: string, how: "sent" | "accepted" | "button"): Promise<AutoPlanResult> {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, companyId },
    select: {
      quoteNumber: true,
      version: true,
      title: true,
      clientId: true,
      contactId: true,
      expiresAt: true,
      opportunityId: true,
      user: { select: { id: true, active: true } },
    },
  })
  if (!quote) return { error: "Quote not found" }
  if (quote.opportunityId) return { plan: null }
  if (!quote.contactId) return { error: QUOTE_NEEDS_CONTACT_MESSAGES[how] }

  await ensureOpportunityDefaults(companyId)
  await ensureTeamDefaults(companyId)

  const [settings, firstOpen, memberships, defaultTeamId, clientLocationId] = await Promise.all([
    prisma.opportunitySettings.findUnique({ where: { companyId }, select: { quoteSentStage: { select: stageSelect } } }),
    prisma.opportunityStage.findFirst({ where: { companyId, category: "OPEN" }, orderBy: STAGE_ORDER, select: stageSelect }),
    prisma.teamMember.findMany({
      where: { userId: quote.user.id, team: { companyId } },
      orderBy: [{ team: { sortOrder: "asc" } }, { team: { createdAt: "asc" } }],
      select: { teamId: true },
    }),
    loadDefaultTeamId(companyId),
    loadClientMainLocationId({ companyId }, quote.clientId),
  ])
  const stage = settings?.quoteSentStage?.category === "OPEN" ? settings.quoteSentStage : firstOpen
  if (!stage) return { error: "Add an open stage in Opportunity Settings first" }
  if (!defaultTeamId) return { error: "The company has no General team" }
  const { teamId, ownerId } = autoOpportunityTeamAndOwner(quote.user, memberships.map((m) => m.teamId), defaultTeamId)

  return {
    plan: {
      quoteOwnerId: quote.user.id,
      input: {
        companyId,
        title: autoOpportunityTitle(quote),
        clientId: quote.clientId,
        contactId: quote.contactId,
        clientLocationId,
        ownerId,
        teamId,
        stage,
        typeId: null,
        source: "QUOTE",
        expectedValue: null,
        expectedCloseDate: closeDateFrom(quote.expiresAt),
        initialNote: { by: "system", html: autoOpportunityNote(quoteLabel(quote), how) },
      },
    },
  }
}

// Creates the planned opportunity and links the quote's family to it, in
// the caller's transaction. The quote row is locked first and read again,
// so two requests sending the same quote never make two opportunities: the
// second finds the link and creates nothing. The opportunity is recorded
// as created by the actor, or by the quote's owner when the system acts.
export async function createLinkedOpportunity(
  tx: Tx,
  opts: { companyId: string; quoteId: string; plan: AutoOpportunityPlan; actorId: string | null }
): Promise<{ id: string; number: string } | null> {
  await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${opts.quoteId} FOR UPDATE`
  const quote = await tx.quote.findFirst({
    where: { id: opts.quoteId, companyId: opts.companyId },
    select: { quoteNumber: true, opportunityId: true },
  })
  if (!quote || quote.opportunityId) return null
  // The title comes from the quote, so it is fitted to the limit, never refused
  const created = await createOpportunityInTransaction(tx, { ...opts.plan.input, createdById: opts.actorId ?? opts.plan.quoteOwnerId, fitTitle: true })
  await setQuoteFamilyOpportunity(tx, { companyId: opts.companyId, actorId: opts.actorId, quoteNumber: quote.quoteNumber, from: null, to: created.id })
  return { id: created.id, number: created.number }
}

// Before a status change: the opportunity it needs to create, when a quote
// without one is sent (SENT or VIEWED) or accepted (createsOpportunity).
// Moving one to Declined, Expired, or Draft plans nothing and needs no
// contact. Run before the change's transaction (and before an email is
// sent); an error (no contact) refuses the change with a 400.
export async function prepareQuoteStatusChange(
  companyId: string,
  quote: { id: string; status: QuoteStatusName; opportunityId: string | null },
  to: QuoteStatusName
): Promise<AutoPlanResult> {
  const how = createsOpportunity(quote.status, to)
  if (!how || quote.opportunityId) return { plan: null }
  return planAutoOpportunity(companyId, quote.id, how)
}

// Inside the status change's transaction, after the quote is written: a
// quote sent or accepted without an opportunity gets the planned one, then the
// change's event (if it is one, quoteEventFor) is applied. Every path that
// changes a quote's status calls this: send, send-email, the status route
// (and the bulk actions through it), the approval completion, the
// customer portal's accept and decline, and expiry marking.
export async function runQuoteStatusChange(
  tx: Tx,
  opts: { companyId: string; quoteId: string; from: QuoteStatusName; to: QuoteStatusName; actorId: string | null; plan: AutoOpportunityPlan | null }
): Promise<QuoteEventResult | null> {
  const event = quoteEventFor(opts.from, opts.to)
  if (opts.plan && createsOpportunity(opts.from, opts.to)) {
    await createLinkedOpportunity(tx, { companyId: opts.companyId, quoteId: opts.quoteId, plan: opts.plan, actorId: opts.actorId })
  }
  if (!event) return null
  return applyQuoteEvent(tx, { companyId: opts.companyId, quoteId: opts.quoteId, event, actorId: opts.actorId })
}

// ─── Value ──────────────────────────────────────────────────────────────────

const valueQuoteSelect = {
  id: true,
  quoteNumber: true,
  version: true,
  isActive: true,
  sentAt: true,
  updatedAt: true,
  opportunityId: true,
  lineItems: { select: { unitPrice: true, quantity: true, discount: true } },
} satisfies Prisma.QuoteSelect

// Each opportunity's value from its latest linked quote (latestQuoteValue),
// for the ones that have linked quotes. Every linked quote counts, whether
// or not the viewer may open it, the same as the manual value; only the
// sell total is ever read, never cost.
export async function loadOpportunityQuoteValues(
  db: Pick<PrismaClient, "quote">,
  companyId: string,
  opportunityIds: readonly string[]
): Promise<Map<string, OpportunityQuoteValue>> {
  const values = new Map<string, OpportunityQuoteValue>()
  if (opportunityIds.length === 0) return values
  const quotes = await db.quote.findMany({ where: { companyId, opportunityId: { in: [...opportunityIds] } }, select: valueQuoteSelect })
  const byOpportunity = new Map<string, typeof quotes>()
  for (const q of quotes) if (q.opportunityId) byOpportunity.set(q.opportunityId, [...(byOpportunity.get(q.opportunityId) ?? []), q])
  for (const [id, linked] of byOpportunity) {
    const value = latestQuoteValue(linked)
    if (value) values.set(id, value)
  }
  return values
}

// Opportunity responses with quoteValue (null without linked quotes)
export async function withQuoteValues<T extends { id: string }>(companyId: string, rows: T[]): Promise<(T & { quoteValue: OpportunityQuoteValue | null })[]> {
  const values = await loadOpportunityQuoteValues(prisma, companyId, rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, quoteValue: values.get(r.id) ?? null }))
}

export async function withQuoteValue<T extends { id: string }>(companyId: string, row: T): Promise<T & { quoteValue: OpportunityQuoteValue | null }> {
  return (await withQuoteValues(companyId, [row]))[0]
}

// ─── Pickers and panels ─────────────────────────────────────────────────────

type Viewer = Pick<AccessContext, "companyId" | "userId" | "access" | "can">

export const linkableOpportunitySelect = {
  id: true,
  number: true,
  title: true,
  clientId: true,
  contactId: true,
  stage: { select: stageSelect },
  team: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect

// The opportunities a record may link to, that the user may open (never a
// deleted one): for a quote, OPEN ones of its client and contact; for a
// sales order or purchase order, any stage, of its client when there is one
// (the same rule as the assertRefs keys quoteOpportunityId and
// orderOpportunityId)
export function loadLinkableOpportunities(ctx: Viewer, opts: { record: "quote" | "order"; clientId: string | null; contactId: string | null }) {
  if (opts.record === "quote" && (!opts.clientId || !opts.contactId)) return Promise.resolve([])
  const filter: Prisma.OpportunityWhereInput =
    opts.record === "quote"
      ? { clientId: opts.clientId!, contactId: opts.contactId!, stage: { category: "OPEN" } }
      : opts.clientId
        ? { clientId: opts.clientId }
        : {}
  return prisma.opportunity.findMany({
    where: { AND: [opportunityListWhere(ctx), filter] },
    select: linkableOpportunitySelect,
    orderBy: { createdAt: "desc" },
    take: 200,
  })
}

const panelOpportunitySelect = {
  ...opportunityRefSelect,
  stage: { select: stageSelect },
  team: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect

export interface RecordOpportunityPanel {
  // The record has an opportunity, whether or not the user may open it
  linked: boolean
  opportunity: Prisma.OpportunityGetPayload<{ select: typeof panelOpportunitySelect }> | null
  // Its linked records the user may open, by their own view rules and the
  // cost rule (the opportunity's Related tab)
  related: OpportunityRelated | null
}

// The Opportunity panel on a quote, sales order, or purchase order page.
// The caller has run the record's own view check. The opportunity itself
// is only shown to users who may open it (VOP).
export async function loadRecordOpportunityPanel(ctx: Viewer, opportunityId: string | null): Promise<RecordOpportunityPanel> {
  if (!opportunityId) return { linked: false, opportunity: null, related: null }
  const opportunity = ctx.can("pages.opportunities")
    ? await prisma.opportunity.findFirst({ where: { AND: [opportunityListWhere(ctx), { id: opportunityId }] }, select: panelOpportunitySelect })
    : null
  if (!opportunity) return { linked: true, opportunity: null, related: null }
  return { linked: true, opportunity, related: await loadOpportunityRelated(prisma, ctx, opportunity.id) }
}
