import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { termsForStorage, termsToDisplayHtml } from "@/lib/sanitize-terms"

// Server side only, like sanitize-terms.ts which it uses.
//
// The one place that decides which terms a quote or template shows. A
// quote has its own stored terms (Quote.terms) and a "use company default"
// flag (Quote.useDefaultTerms); the company default is
// CompanySettings.quoteTerms.
//   - Not sent yet (sentAt is null, the same notion portal-access.ts uses)
//     with the flag ticked: the CURRENT company default.
//   - Otherwise: the stored terms. Sending freezes the default into the
//     stored terms in the same write that marks the quote sent, so a sent
//     quote keeps what the customer received whatever the flag says.
// Templates are never sent, so they always follow the rule for drafts.
// Every result goes through the sanitizer, and plain legacy text keeps its
// line breaks.

export interface QuoteTermsState {
  terms: string | null
  useDefaultTerms: boolean
  sentAt: Date | string | null
}

export interface TemplateTermsState {
  terms: string | null
  useDefaultTerms: boolean
}

export function resolveQuoteTerms(quote: QuoteTermsState, companyDefault: string | null | undefined): string | null {
  const raw = !quote.sentAt && quote.useDefaultTerms ? companyDefault : quote.terms
  return termsToDisplayHtml(raw ?? null) || null
}

export function resolveTemplateTerms(template: TemplateTermsState, companyDefault: string | null | undefined): string | null {
  return resolveQuoteTerms({ ...template, sentAt: null }, companyDefault)
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

// What the staff pages need: the effective terms to show, plus whether the
// stored terms would be replaced by ticking the flag. The stored terms stay
// in `terms` for the editor.
export function quoteTermsView(quote: QuoteTermsState, companyDefault: string | null | undefined) {
  return {
    effectiveTerms: resolveQuoteTerms(quote, companyDefault),
    termsDifferFromDefault: termsDifferFromDefault(quote.terms, companyDefault),
  }
}

export function templateTermsView(template: TemplateTermsState, companyDefault: string | null | undefined) {
  return quoteTermsView({ ...template, sentAt: null }, companyDefault)
}

// ─── Freezing on send ────────────────────────────────────────────────────

// The stored terms a send writes: the current default, but only for a quote
// not sent yet with the flag ticked. null means the send leaves terms alone.
export interface TermsFreeze {
  terms: string | null
}

export function termsFreezeFor(
  quote: Pick<QuoteTermsState, "useDefaultTerms" | "sentAt">,
  companyDefault: string | null | undefined
): TermsFreeze | null {
  if (quote.sentAt || !quote.useDefaultTerms) return null
  return { terms: termsForStorage(companyDefault) }
}

// The quote as it will read once the send marks it sent, so a PDF built
// before that write (the one attached to the email) carries exactly the
// terms the write stores
export function asSent<T extends QuoteTermsState>(quote: T, freeze: TermsFreeze | null): T {
  if (!freeze) return quote
  return { ...quote, terms: freeze.terms, sentAt: quote.sentAt ?? new Date() }
}

// Runs inside the transaction that marks the quote sent, before that
// update. One conditional write: only a quote that is still not sent gets
// the frozen terms, so a second send (or a race with one) never replaces
// the text the first one froze.
export async function applyTermsFreeze(
  tx: Prisma.TransactionClient,
  quoteId: string,
  freeze: TermsFreeze | null
): Promise<void> {
  if (!freeze) return
  await tx.quote.updateMany({ where: { id: quoteId, sentAt: null }, data: { terms: freeze.terms } })
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
