import { prisma } from "@/lib/prisma"
import type { QuoteLineItem } from "@/generated/prisma"

type QuoteLineItemWithCatalog = QuoteLineItem & {
  catalogItem: { vendorId: string | null; sku: string | null } | null
}

// Only line items that were actually "chosen" become part of the Sales
// Order. Unselected optional items and unselected choice-group options are
// both flagged the same way (isOptional && !optionalSelected), so this one
// condition correctly drops both cases. Bundle headers, bundle children,
// and text blocks are always kept as-is.
function resolveOrderedLineItems(lineItems: QuoteLineItemWithCatalog[]) {
  return lineItems.filter((li) => !li.isTextBlock && !(li.isOptional && !li.optionalSelected))
}

// Converts an accepted quote into its Sales Order. Idempotent — SalesOrder
// has a unique constraint on quoteId, and this can be triggered from two
// places (client accepting on the portal, or a rep manually changing
// status), so it always checks for an existing SO first rather than risking
// a duplicate-key error or a second SO being created.
export async function createSalesOrderFromAcceptedQuote(quoteId: string) {
  const existing = await prisma.salesOrder.findUnique({ where: { quoteId } })
  if (existing) return existing

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      lineItems: {
        orderBy: { sortOrder: "asc" },
        include: { catalogItem: { select: { vendorId: true, sku: true } } },
      },
      client: { include: { mainShippingLocation: true } },
      company: { include: { settings: true } },
    },
  })
  if (!quote) return null

  const orderedItems = resolveOrderedLineItems(quote.lineItems)

  const prefix = quote.company.settings?.soPrefix ?? "SO"
  const year = new Date().getFullYear()
  const existingCount = await prisma.salesOrder.count({ where: { companyId: quote.companyId } })
  const soNumber = `${prefix}-${year}-${String(existingCount + 1).padStart(4, "0")}`

  const salesOrder = await prisma.salesOrder.create({
    data: {
      companyId: quote.companyId,
      quoteId: quote.id,
      clientId: quote.clientId,
      userId: quote.userId,
      soNumber,
      clientPoNumber: quote.clientPoNumber,
      status: "DRAFT",
      paymentTerms: quote.paymentTerms,
      shipAddress: quote.client.mainShippingLocation?.address ?? null,
      shipCity: quote.client.mainShippingLocation?.city ?? null,
      shipState: quote.client.mainShippingLocation?.state ?? null,
      shipZip: quote.client.mainShippingLocation?.zip ?? null,
      shipCountry: null,
      lineItems: {
        create: orderedItems.map((li) => ({
          catalogItemId: li.catalogItemId,
          // A catalog-sourced item's own part number/SKU carries through
          // as partNumber, and its assigned Vendor (who you'd buy it from)
          // carries through as vendorId. Ad-hoc quote items have no
          // catalogItem link, so both simply stay null — there's no vendor
          // data anywhere upstream for those.
          vendorId: li.catalogItem?.vendorId ?? null,
          partNumber: li.sku,
          name: li.name,
          description: li.description,
          sku: li.sku,
          section: li.section,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          cost: li.cost,
          discount: li.discount,
          taxable: li.taxable,
          isRecurring: li.isRecurring,
          recurringInterval: li.recurringInterval,
          isTextBlock: li.isTextBlock,
          bundleName: li.bundleName,
          bundleDisplayMode: li.bundleDisplayMode,
          isBundleHeader: li.isBundleHeader,
          sortOrder: li.sortOrder,
        })),
      },
    },
  })

  return salesOrder
}