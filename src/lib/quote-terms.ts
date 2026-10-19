import type { Prisma, QuoteStatus } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { termsForStorage, termsToDisplayHtml } from "@/lib/sanitize-terms"

// Server side only, like sanitize-terms.ts which it uses.
//
// The one place that decides which terms a quote or template shows. A
// quote has its own stored terms (Quote.terms) and a "use company default"
// flag (Quote.useDefaultTerms); the company default is
// CompanySettings.quoteTerms.
//   - Not frozen (isTermsFrozen below) with the flag ticked: the CURRENT
//     company default.
//   - Otherwise: the stored terms. Every transition that freezes a quote
//     copies the default into the stored terms in the same transaction, so
//     a frozen quote keeps its terms whatever the flag or the default says.
// Templates are never sent, so they always follow the rule for drafts.
// Every result goes through the sanitizer, and plain legacy text keeps its
// line breaks.

export interface QuoteTermsState {
  terms: string | null
  useDefaultTerms: boolean
  sentAt: Date | string | null
  status: QuoteStatus
}

// ─── Frozen ──────────────────────────────────────────────────────────────

// The only statuses whose terms still follow the company default. Every
// other status (SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED) is frozen.
export const UNFROZEN_STATUSES: readonly QuoteStatus[] = ["DRAFT", "PENDING_APPROVAL"]

export function isFrozenStatus(status: QuoteStatus): boolean {
  return !UNFROZEN_STATUSES.includes(status)
}

// The one definition of a frozen quote: it has been sent (sentAt is set,
// which nothing ever clears, so a sent quote moved back to DRAFT stays
// frozen), or its status is past DRAFT and PENDING_APPROVAL (for example a
// quote set to ACCEPTED by hand without ever being sent). A frozen quote
// shows its stored terms, and its terms and flag can't be changed.
export function isTermsFrozen(quote: Pick<QuoteTermsState, "sentAt" | "status">): boolean {
  return !!quote.sentAt || isFrozenStatus(quote.status)
}

// The same definition as a database condition: a quote NOT yet frozen
export const notFrozenWhere = {
  sentAt: null,
  status: { in: [...UNFROZEN_STATUSES] },
} satisfies Prisma.QuoteWhereInput

export interface TemplateTermsState {
  terms: string | null
  useDefaultTerms: boolean
}

export function resolveQuoteTerms(quote: QuoteTermsState, companyDefault: string | null | undefined): string | null {
  const raw = !isTermsFrozen(quote) && quote.useDefaultTerms ? companyDefault : quote.terms
  return termsToDisplayHtml(raw ?? null) || null
}

export function resolveTemplateTerms(template: TemplateTermsState, companyDefault: string | null | undefined): string | null {
  return resolveQuoteTerms({ ...template, sentAt: null, status: "DRAFT" }, companyDefault)
}

// The company default terms as stored, loaded once per request
export async function loadCompanyDefaultTerms(companyId: string): Promise<string | null> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { quoteTerms: true },
  })
  return settings?.quoteTerms ?? null
}

// Stored terms that differ from what the default would show. The pages ask
// before ticking the flag over them, since ticking replaces them.
export function termsDifferFromDefault(stored: string | null, companyDefault: string | null | undefined): boolean {
  const own = termsToDisplayHtml(stored) || ""
  return own !== "" && own !== (termsToDisplayHtml(companyDefault ?? null) || "")
}

// What the staff pages need: the effective terms to show, whether the
// stored terms would be replaced by ticking the flag, and whether the terms
// are frozen (shown read only). The stored terms stay in `terms` for the
// editor.
export function quoteTermsView(quote: QuoteTermsState, companyDefault: string | null | undefined) {
  return {
    effectiveTerms: resolveQuoteTerms(quote, companyDefault),
    termsDifferFromDefault: termsDifferFromDefault(quote.terms, companyDefault),
    termsFrozen: isTermsFrozen(quote),
  }
}

export function templateTermsView(template: TemplateTermsState, companyDefault: string | null | undefined) {
  // Templates are never frozen, so they carry no termsFrozen
  return {
    effectiveTerms: resolveTemplateTerms(template, companyDefault),
    termsDifferFromDefault: termsDifferFromDefault(template.terms, companyDefault),
  }
}

// ─── Freezing ────────────────────────────────────────────────────────────

// The stored terms a freezing transition (a send, or a status change past
// DRAFT and PENDING_APPROVAL) writes: the current default, but only for a
// quote not frozen yet with the flag ticked. null means terms stay as they are.
export interface TermsFreeze {
  terms: string | null
}

export function termsFreezeFor(
  quote: Pick<QuoteTermsState, "useDefaultTerms" | "sentAt" | "status">,
  companyDefault: string | null | undefined
): TermsFreeze | null {
  if (isTermsFrozen(quote) || !quote.useDefaultTerms) return null
  return { terms: termsForStorage(companyDefault) }
}

// The quote as it will read once the send marks it sent, so a PDF built
// before that write (the one attached to the email) carries exactly the
// terms the write stores
export function asSent<T extends QuoteTermsState>(quote: T, freeze: TermsFreeze | null): T {
  if (!freeze) return quote
  return { ...quote, terms: freeze.terms, sentAt: quote.sentAt ?? new Date() }
}

// Runs inside the transaction that freezes the quote, before the update
// that changes its status. One conditional write: only a quote that is
// still not frozen gets the terms, so a second run (or a race with one)
// never replaces the text the first one froze.
export async function applyTermsFreeze(
  tx: Prisma.TransactionClient,
  quoteId: string,
  freeze: TermsFreeze | null
): Promise<void> {
  if (!freeze) return
  await tx.quote.updateMany({ where: { id: quoteId, ...notFrozenWhere }, data: { terms: freeze.terms } })
}

// ─── Saving the flag and the terms ───────────────────────────────────────

// The terms fields a PATCH (or a create) writes, from the request and the
// record's current flag. Ticking the flag stores a copy of the current
// default; unticking it without new text also stores a copy, so the editor
// starts from the default text; while the flag stays ticked, terms sent in
// the request are replaced by the default copy so stored and effective
// agree. Everything stored is sanitized.
export function termsPatchData(
  currentFlag: boolean,
  body: { terms?: unknown; useDefaultTerms?: unknown },
  companyDefault: string | null | undefined
): { terms?: string | null; useDefaultTerms?: boolean } {
  const touchesFlag = body.useDefaultTerms !== undefined
  const touchesTerms = body.terms !== undefined
  if (!touchesFlag && !touchesTerms) return {}

  const flag = touchesFlag ? !!body.useDefaultTerms : currentFlag
  const data: { terms?: string | null; useDefaultTerms?: boolean } = {}
  if (touchesFlag) data.useDefaultTerms = flag

  if (flag) data.terms = termsForStorage(companyDefault)
  else if (touchesTerms) data.terms = termsForStorage(body.terms)
  else if (currentFlag) data.terms = termsForStorage(companyDefault)
  return data
}

// Only touches the database when the request changes the terms or the flag
export function requestTouchesTerms(body: { terms?: unknown; useDefaultTerms?: unknown }): boolean {
  return body.terms !== undefined || body.useDefaultTerms !== undefined
}
