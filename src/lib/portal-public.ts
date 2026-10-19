import type { Prisma } from "@/generated/prisma"
import { resolveQuoteTerms } from "@/lib/quote-terms"

// The only quote fields the customer portal ever sends to the browser.
// Every portal route that returns quote data selects through these, so
// cost, internal notes, the held email payload, both access tokens, and
// internal ids (companyId, userId, the quote's own id) can never reach a
// customer. The line item id stays because the portal sends it back when
// a customer toggles an optional item or changes a quantity.

export const portalLineItemSelect = {
  id: true,
  section: true,
  sortOrder: true,
  name: true,
  description: true,
  sku: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  taxable: true,
  isRecurring: true,
  recurringInterval: true,
  isOptional: true,
  optionalSelected: true,
  quantityAdjustable: true,
  choiceGroup: true,
  isTextBlock: true,
  bundleName: true,
  bundleDisplayMode: true,
  isBundleHeader: true,
} satisfies Prisma.QuoteLineItemSelect

export const portalQuoteSelect = {
  quoteNumber: true,
  version: true,
  status: true,
  title: true,
  introText: true,
  terms: true,
  // Read only to work out the effective terms; never sent to the browser
  useDefaultTerms: true,
  sections: true,
  clientPoNumber: true,
  shipAddress: true,
  shipCity: true,
  shipState: true,
  shipZip: true,
  shipCountry: true,
  shipContactName: true,
  createdAt: true,
  sentAt: true,
  viewedAt: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  declineReason: true,
  taxRate: true,
  client: { select: { name: true } },
  contact: { select: { firstName: true, lastName: true } },
  // The portal shows the rep's name only, never their email
  user: { select: { name: true } },
  company: {
    select: {
      name: true,
      logoUrl: true,
      secondaryLogoUrl: true,
      // quoteTerms is read only to work out the effective terms; it is
      // removed by toPortalQuote and never sent to the browser
      settings: { select: { primaryColor: true, accentColor: true, quoteTerms: true } },
    },
  },
  lineItems: { orderBy: { sortOrder: "asc" }, select: portalLineItemSelect },
} satisfies Prisma.QuoteSelect

export type PortalQuoteRow = Prisma.QuoteGetPayload<{ select: typeof portalQuoteSelect }>

// Every portal response (the customer link and the internal preview) goes
// through here: terms are the effective terms from resolveQuoteTerms,
// already sanitized, and the flag and the company default are left out
export function toPortalQuote(row: PortalQuoteRow, isInternalPreview: boolean) {
  const { useDefaultTerms, company, ...rest } = row
  const { settings, ...companyRest } = company
  const companyDefault = settings?.quoteTerms ?? null
  return {
    ...rest,
    terms: resolveQuoteTerms({ terms: row.terms, useDefaultTerms, sentAt: row.sentAt }, companyDefault),
    company: {
      ...companyRest,
      settings: settings ? { primaryColor: settings.primaryColor, accentColor: settings.accentColor } : null,
    },
    isInternalPreview,
  }
}
