import { OPPORTUNITY_TITLE_MAX } from "@/lib/opportunity-rules"

// The rules that tie quotes to opportunities: which quote status changes are
// events, where each event moves the opportunity, what an automatically
// created opportunity is made of, and when the Won prompt offers a sales
// order. No React and no database imports, so the screens and the server
// share them and each rule can be checked on its own. The database side is
// src/lib/opportunity-quotes.ts.

export type QuoteStatusName = "DRAFT" | "PENDING_APPROVAL" | "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED" | "EXPIRED"
export type StageCategoryName = "OPEN" | "WON" | "LOST"

export type QuoteEvent = "sent" | "accepted" | "declined" | "expired"

// A quote in one of these hasn't left Draft yet
const NOT_YET_OUT: readonly QuoteStatusName[] = ["DRAFT", "PENDING_APPROVAL"]
// In front of the customer, waiting on an answer
const OUT_WITH_CUSTOMER: readonly QuoteStatusName[] = ["SENT", "VIEWED"]

// The event a status change is, or null for one that isn't (no change, a
// move back to Draft, SENT to VIEWED, a request for approval)
export function quoteEventFor(from: QuoteStatusName, to: QuoteStatusName): QuoteEvent | null {
  if (from === to) return null
  if (OUT_WITH_CUSTOMER.includes(to)) return OUT_WITH_CUSTOMER.includes(from) ? null : "sent"
  if (to === "ACCEPTED") return "accepted"
  if (to === "DECLINED") return "declined"
  if (to === "EXPIRED") return "expired"
  return null
}

// A quote leaving Draft (sent, or moved through the status menu to any
// status past Draft and Pending Approval) gets an opportunity when it has none
export function leavesDraft(from: QuoteStatusName, to: QuoteStatusName): boolean {
  return NOT_YET_OUT.includes(from) && !NOT_YET_OUT.includes(to)
}

// A quote's own number as people read it: "Q-2026-0042", or "Q-2026-0042 v2"
export function quoteLabel(quote: { quoteNumber: string; version: number }): string {
  return quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber
}

const EVENT_WORDS: Record<QuoteEvent, string> = { sent: "sent", accepted: "accepted", declined: "declined", expired: "expired" }

// Why an automatic stage move happened, stored with the stage_changed entry:
// "Quote Q-2026-0042 accepted"
export function quoteEventReason(event: QuoteEvent, label: string): string {
  return `Quote ${label} ${EVENT_WORDS[event]}`
}

export interface StageChoice {
  id: string
  name: string
  category: StageCategoryName
}

// What the other quotes linked to the same opportunity say
export interface OtherQuotesState {
  // A draft or sent quote is still waiting
  open: boolean
  // A quote was accepted
  accepted: boolean
}

// Where an event moves the opportunity, or null to leave it:
//   sent: to the company's quote sent stage, only from an OPEN stage
//   accepted: to the first WON stage, from any stage (LOST included)
//   declined, expired: to the first LOST stage, only when no other linked
//     quote is still open (draft or sent) or accepted
// Never a move to the stage it is already in.
export function stageForQuoteEvent(
  event: QuoteEvent,
  current: StageChoice,
  targets: { sent: StageChoice | null; firstWon: StageChoice | null; firstLost: StageChoice | null },
  others: OtherQuotesState
): StageChoice | null {
  let target: StageChoice | null = null
  if (event === "sent") target = current.category === "OPEN" ? targets.sent : null
  else if (event === "accepted") target = targets.firstWon
  else target = others.open || others.accepted ? null : targets.firstLost
  return target && target.id !== current.id ? target : null
}

export interface LinkedQuoteState {
  id: string
  quoteNumber: string
  version: number
  status: QuoteStatusName
  isActive: boolean
}

// What the opportunity's other linked quotes say, for a declined or expired
// event on one of them. A quote and its versions are one quote (a family,
// sharing the number): another family counts as open when one of its rows
// is a draft or its current version (the active one, else the newest) is
// waiting on the customer, and as accepted when any row was accepted. In
// the quote's own family only a draft (a new version being written) counts,
// since an older version stays SENT after a newer one goes out.
export function otherQuotesState(linked: readonly LinkedQuoteState[], quote: { id: string; quoteNumber: string }): OtherQuotesState {
  const state: OtherQuotesState = { open: false, accepted: false }
  const families = new Map<string, LinkedQuoteState[]>()
  for (const row of linked) {
    if (row.id === quote.id) continue
    if (row.quoteNumber === quote.quoteNumber) {
      if (NOT_YET_OUT.includes(row.status)) state.open = true
      continue
    }
    families.set(row.quoteNumber, [...(families.get(row.quoteNumber) ?? []), row])
  }
  for (const rows of families.values()) {
    if (rows.some((r) => r.status === "ACCEPTED")) state.accepted = true
    if (rows.some((r) => NOT_YET_OUT.includes(r.status))) state.open = true
    const current = rows.find((r) => r.isActive) ?? [...rows].sort((a, b) => b.version - a.version)[0]
    if (current && OUT_WITH_CUSTOMER.includes(current.status)) state.open = true
  }
  return state
}

// ─── The automatic opportunity ──────────────────────────────────────────────

export const QUOTE_NEEDS_CONTACT_MESSAGE =
  "Choose a contact for this quote first. Sending it creates its opportunity, which needs a contact."

// The team and owner of an opportunity made from a quote: the quote owner's
// first team by sortOrder (ownerTeamIds in that order), otherwise General,
// and the quote owner as owner only when they are a member of that team (an
// owner who is in no team, or no longer active, leaves it unassigned)
export function autoOpportunityTeamAndOwner(
  quoteOwner: { id: string; active: boolean },
  ownerTeamIds: readonly string[],
  defaultTeamId: string
): { teamId: string; ownerId: string | null } {
  const teamId = ownerTeamIds[0] ?? defaultTeamId
  return { teamId, ownerId: quoteOwner.active && ownerTeamIds.includes(teamId) ? quoteOwner.id : null }
}

// The title: the quote's own, else "Quote Q-2026-0042", within the title limit
export function autoOpportunityTitle(quote: { title: string | null; quoteNumber: string; version: number }): string {
  const title = quote.title?.trim() || `Quote ${quoteLabel(quote)}`
  return title.slice(0, OPPORTUNITY_TITLE_MAX)
}

// The note the system writes as its first timeline entry
export function autoOpportunityNote(label: string, how: "sent" | "button"): string {
  return how === "sent" ? `<p>Created automatically when quote ${label} was sent</p>` : `<p>Created from quote ${label}</p>`
}

// ─── Linking ────────────────────────────────────────────────────────────────

// Whether an opportunity may be a quote's: an OPEN one for the quote's own
// client and contact (the server also checks it is visible and not deleted)
export function isLinkableForQuote(
  opportunity: { clientId: string; contactId: string; stage: { category: StageCategoryName } },
  quote: { clientId: string; contactId: string | null }
): boolean {
  return opportunity.stage.category === "OPEN" && opportunity.clientId === quote.clientId && opportunity.contactId === quote.contactId
}

// Whether a quote's link still fits after its client or contact changes:
// the same client and contact as the opportunity
export function linkStillMatches(
  opportunity: { clientId: string; contactId: string },
  quote: { clientId: string; contactId: string | null }
): boolean {
  return opportunity.clientId === quote.clientId && opportunity.contactId === quote.contactId
}

// ─── Won with no quote ──────────────────────────────────────────────────────

// After a user moves an opportunity into a WON stage (the panel, a Won
// button, a board drag, a note), the page asks "Create a sales order for
// this opportunity?" when it has no linked quote and the user may create
// sales orders. Never on a move within WON, and never automatic.
export function offersSalesOrderAfterMove(opts: {
  from: StageCategoryName
  to: StageCategoryName
  hasLinkedQuote: boolean
  canCreateSalesOrders: boolean
}): boolean {
  return opts.to === "WON" && opts.from !== "WON" && !opts.hasLinkedQuote && opts.canCreateSalesOrders
}

// The prompt's words, the same from every place that shows it
export const WON_SALES_ORDER_PROMPT = {
  title: "Create a sales order for this opportunity?",
  description: "It opens the New Sales Order form for this client, linked to this opportunity.",
  confirmLabel: "Create",
  cancelLabel: "Not now",
} as const

// Where the prompt's Create, and the Related tab's buttons, open their forms
export function newSalesOrderHref(opportunityId: string): string {
  return `/dashboard/sales-orders/new?opportunity=${encodeURIComponent(opportunityId)}`
}

export function newPurchaseOrderHref(opportunityId: string): string {
  return `/dashboard/purchase-orders/new?opportunity=${encodeURIComponent(opportunityId)}`
}

// The Raise Quote action: the quotes page opens its template picker, which
// carries the opportunity on to the New Quote form
export function raiseQuoteHref(opportunityId: string): string {
  return `/dashboard/quotes?raiseFor=${encodeURIComponent(opportunityId)}`
}

export function newQuoteHref(templateId: string, opportunityId: string | null): string {
  const base = `/dashboard/quotes/new?template=${encodeURIComponent(templateId)}`
  return opportunityId ? `${base}&opportunity=${encodeURIComponent(opportunityId)}` : base
}

// An opportunity id from a page's query string: cuid like text only
const URL_ID = /^[A-Za-z0-9_-]{1,64}$/
export function readOpportunityParam(value: string | null): string | null {
  return value && URL_ID.test(value) ? value : null
}
