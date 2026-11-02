import { quoteLabel } from "@/lib/opportunity-quote-rules"

// An opportunity's value while it has linked quotes: the sell total of its
// latest linked quote, worked out when it is read (never stored), so it
// always follows the quote. Without linked quotes the opportunity keeps its
// own manual expectedValue. No React and no database imports; the server
// loads the quotes (loadOpportunityQuoteValues in
// src/lib/opportunity-quotes.ts) and every screen shows the result through
// opportunityDisplayValue.

// The sell total of a quote's lines, the same total the quotes list shows.
// Only prices: never cost or margin.
export function quoteSellTotal(lines: readonly { unitPrice: number; quantity: number; discount: number }[]): number {
  return lines.reduce((sum, li) => sum + li.unitPrice * li.quantity * (1 - li.discount / 100), 0)
}

// The one place a Float total becomes a Decimal(12, 2) amount: rounded to
// 2 decimal places (half away from zero, after the float error), as the
// text expectedValue uses ("1250.50"). Below zero, or not a number, is 0.
export function moneyText(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0.00"
  return (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2)
}

export interface LinkedQuoteForValue {
  id: string
  quoteNumber: string
  version: number
  isActive: boolean
  sentAt: Date | string | null
  updatedAt: Date | string
  lineItems: readonly { unitPrice: number; quantity: number; discount: number }[]
}

export interface OpportunityQuoteValue {
  quoteId: string
  // "Q-2026-0042", or "Q-2026-0042 v2"
  label: string
  // Decimal text, for example "1250.50"
  value: string
}

const time = (value: Date | string | null) => (value === null ? -Infinity : new Date(value).getTime())

// The quote the value comes from: the most recently sent quote's current
// version when any linked quote was sent (the family's active version,
// else its most recently sent one), otherwise the most recently updated
// linked draft. Null without linked quotes.
export function latestLinkedQuote<T extends LinkedQuoteForValue>(quotes: readonly T[]): T | null {
  if (quotes.length === 0) return null
  const sent = quotes.filter((q) => q.sentAt !== null)
  if (sent.length > 0) {
    const newest = sent.reduce((a, b) => (time(b.sentAt) > time(a.sentAt) ? b : a))
    const family = quotes.filter((q) => q.quoteNumber === newest.quoteNumber)
    return family.find((q) => q.isActive) ?? newest
  }
  return quotes.reduce((a, b) => (time(b.updatedAt) > time(a.updatedAt) ? b : a))
}

export function latestQuoteValue(quotes: readonly LinkedQuoteForValue[]): OpportunityQuoteValue | null {
  const quote = latestLinkedQuote(quotes)
  if (!quote) return null
  return { quoteId: quote.id, label: quoteLabel(quote), value: moneyText(quoteSellTotal(quote.lineItems)) }
}

// The value every screen shows (board cards and column totals, the list, the
// opportunity page): the latest quote's total while there is one, otherwise
// the manual expected value
export function opportunityDisplayValue(o: { expectedValue: string | null; quoteValue?: OpportunityQuoteValue | null }): string | null {
  return o.quoteValue ? o.quoteValue.value : o.expectedValue
}
