import type { Prisma, RecurringInterval } from "@/generated/prisma"

// The one list of line item fields a new quote takes from an existing line:
// a quote copy, a new version, and a quote made from a template all build
// their lines here, so every kind of line comes across whole.
//
// Bundles and choice groups are tied together by name, not by id: a bundle
// is its header (isBundleHeader) plus every line with the same bundleName
// in the same section, and a choice group is every line with the same
// choiceGroup, the chosen option being the one with optionalSelected. So
// copying the names as they are keeps every child under its new header and
// every option in its new group, and only the row ids are new.
//
// cost is the stored cost from the source row the server loaded, never a
// value from the request.
export interface CopyableLine {
  catalogItemId: string | null
  section: string | null
  sortOrder: number
  name: string
  description: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  cost: number
  discount: number
  taxable: boolean
  isRecurring: boolean
  recurringInterval: RecurringInterval | null
  isOptional: boolean
  optionalSelected: boolean
  quantityAdjustable: boolean
  choiceGroup: string | null
  isTextBlock: boolean
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
}

export function copiedLineData(li: CopyableLine): Prisma.QuoteLineItemUncheckedCreateWithoutQuoteInput {
  return {
    catalogItemId: li.catalogItemId,
    section: li.section,
    sortOrder: li.sortOrder,
    name: li.name,
    description: li.description,
    sku: li.sku,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    cost: li.cost,
    discount: li.discount,
    taxable: li.taxable,
    isRecurring: li.isRecurring,
    recurringInterval: li.recurringInterval,
    isOptional: li.isOptional,
    optionalSelected: li.optionalSelected,
    quantityAdjustable: li.quantityAdjustable,
    choiceGroup: li.choiceGroup,
    isTextBlock: li.isTextBlock,
    bundleName: li.bundleName,
    bundleDisplayMode: li.bundleDisplayMode,
    isBundleHeader: li.isBundleHeader,
  }
}

// The source lines in the order the quote shows them, so the new rows are
// written (and their createdAt set) in that same order
export const COPY_SOURCE_LINE_ORDER = [
  { sortOrder: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
]
