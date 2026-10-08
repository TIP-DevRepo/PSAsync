import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"

// Company scoped lookups for ids that arrive in an API route's URL. Every
// where clause goes through the parent record up to the caller's company,
// so a record from another company is never returned, and a child id is
// always tied to the parent id in the same URL. A miss returns null, which
// the route turns into notFound() without saying whether the id exists
// elsewhere.
//
// The *Where builders are exported too, so an update or delete can put the
// same scoping in its own where clause instead of trusting an earlier read.

type Scope = Pick<AccessContext, "companyId">

// Clients

export const clientWhere = (ctx: Scope, clientId: string) =>
  ({ id: clientId, companyId: ctx.companyId }) satisfies Prisma.ClientWhereUniqueInput

export const clientContactWhere = (ctx: Scope, clientId: string, contactId: string) =>
  ({
    id: contactId,
    clientId,
    client: { id: clientId, companyId: ctx.companyId },
  }) satisfies Prisma.ContactWhereUniqueInput

export const clientLocationWhere = (ctx: Scope, clientId: string, locationId: string) =>
  ({
    id: locationId,
    clientId,
    client: { id: clientId, companyId: ctx.companyId },
  }) satisfies Prisma.ClientLocationWhereUniqueInput

export function loadClient(ctx: Scope, clientId: string) {
  return prisma.client.findFirst({ where: clientWhere(ctx, clientId), select: { id: true } })
}

export function loadClientContact(ctx: Scope, clientId: string, contactId: string) {
  return prisma.contact.findFirst({ where: clientContactWhere(ctx, clientId, contactId), select: { id: true } })
}

export function loadClientLocation(ctx: Scope, clientId: string, locationId: string) {
  return prisma.clientLocation.findFirst({
    where: clientLocationWhere(ctx, clientId, locationId),
    select: { id: true },
  })
}

// Vendors

export const vendorWhere = (ctx: Scope, vendorId: string) =>
  ({ id: vendorId, companyId: ctx.companyId }) satisfies Prisma.VendorWhereUniqueInput

export const vendorContactWhere = (ctx: Scope, vendorId: string, contactId: string) =>
  ({
    id: contactId,
    vendorId,
    vendor: { id: vendorId, companyId: ctx.companyId },
  }) satisfies Prisma.VendorContactWhereUniqueInput

export const vendorLocationWhere = (ctx: Scope, vendorId: string, locationId: string) =>
  ({
    id: locationId,
    vendorId,
    vendor: { id: vendorId, companyId: ctx.companyId },
  }) satisfies Prisma.VendorLocationWhereUniqueInput

export const vendorAttachmentWhere = (ctx: Scope, vendorId: string, attachmentId: string) =>
  ({
    id: attachmentId,
    vendorId,
    vendor: { id: vendorId, companyId: ctx.companyId },
  }) satisfies Prisma.VendorAttachmentWhereUniqueInput

export function loadVendor(ctx: Scope, vendorId: string) {
  return prisma.vendor.findFirst({ where: vendorWhere(ctx, vendorId), select: { id: true } })
}

export function loadVendorContact(ctx: Scope, vendorId: string, contactId: string) {
  return prisma.vendorContact.findFirst({
    where: vendorContactWhere(ctx, vendorId, contactId),
    select: { id: true },
  })
}

export function loadVendorLocation(ctx: Scope, vendorId: string, locationId: string) {
  return prisma.vendorLocation.findFirst({
    where: vendorLocationWhere(ctx, vendorId, locationId),
    select: { id: true },
  })
}

export function loadVendorAttachment(ctx: Scope, vendorId: string, attachmentId: string) {
  return prisma.vendorAttachment.findFirst({
    where: vendorAttachmentWhere(ctx, vendorId, attachmentId),
    select: { id: true },
  })
}

// Catalog and inventory

export const catalogItemWhere = (ctx: Scope, catalogItemId: string) =>
  ({ id: catalogItemId, companyId: ctx.companyId }) satisfies Prisma.CatalogItemWhereUniqueInput

export const inventoryAssetWhere = (ctx: Scope, assetId: string) =>
  ({ id: assetId, companyId: ctx.companyId }) satisfies Prisma.InventoryAssetWhereUniqueInput

export const inventoryAssetAttachmentWhere = (ctx: Scope, assetId: string, attachmentId: string) =>
  ({
    id: attachmentId,
    assetId,
    asset: { id: assetId, companyId: ctx.companyId },
  }) satisfies Prisma.InventoryAssetAttachmentWhereUniqueInput

export function loadCatalogItem(ctx: Scope, catalogItemId: string) {
  return prisma.catalogItem.findFirst({ where: catalogItemWhere(ctx, catalogItemId), select: { id: true } })
}

export function loadInventoryAsset(ctx: Scope, assetId: string) {
  return prisma.inventoryAsset.findFirst({ where: inventoryAssetWhere(ctx, assetId), select: { id: true } })
}

export function loadInventoryAssetAttachment(ctx: Scope, assetId: string, attachmentId: string) {
  return prisma.inventoryAssetAttachment.findFirst({
    where: inventoryAssetAttachmentWhere(ctx, assetId, attachmentId),
    select: { id: true },
  })
}

// Sales orders

export const salesOrderWhere = (ctx: Scope, salesOrderId: string) =>
  ({ id: salesOrderId, companyId: ctx.companyId }) satisfies Prisma.SalesOrderWhereUniqueInput

export const salesOrderLineItemWhere = (ctx: Scope, salesOrderId: string, lineItemId: string) =>
  ({
    id: lineItemId,
    salesOrderId,
    salesOrder: { id: salesOrderId, companyId: ctx.companyId },
  }) satisfies Prisma.SOLineItemWhereUniqueInput

export const salesOrderAttachmentWhere = (ctx: Scope, salesOrderId: string, attachmentId: string) =>
  ({
    id: attachmentId,
    salesOrderId,
    salesOrder: { id: salesOrderId, companyId: ctx.companyId },
  }) satisfies Prisma.SOAttachmentWhereUniqueInput

export function loadSalesOrder(ctx: Scope, salesOrderId: string) {
  return prisma.salesOrder.findFirst({ where: salesOrderWhere(ctx, salesOrderId), select: { id: true } })
}

// Also selects what deleting a bundle header needs
export function loadSalesOrderLineItem(ctx: Scope, salesOrderId: string, lineItemId: string) {
  return prisma.sOLineItem.findFirst({
    where: salesOrderLineItemWhere(ctx, salesOrderId, lineItemId),
    select: { id: true, salesOrderId: true, isBundleHeader: true, bundleName: true },
  })
}

export function loadSalesOrderAttachment(ctx: Scope, salesOrderId: string, attachmentId: string) {
  return prisma.sOAttachment.findFirst({
    where: salesOrderAttachmentWhere(ctx, salesOrderId, attachmentId),
    select: { id: true },
  })
}

// Purchase orders

export const purchaseOrderWhere = (ctx: Scope, purchaseOrderId: string) =>
  ({ id: purchaseOrderId, companyId: ctx.companyId }) satisfies Prisma.PurchaseOrderWhereUniqueInput

export const purchaseOrderLineItemWhere = (ctx: Scope, purchaseOrderId: string, lineItemId: string) =>
  ({
    id: lineItemId,
    purchaseOrderId,
    purchaseOrder: { id: purchaseOrderId, companyId: ctx.companyId },
  }) satisfies Prisma.POLineItemWhereUniqueInput

export const purchaseOrderAttachmentWhere = (ctx: Scope, purchaseOrderId: string, attachmentId: string) =>
  ({
    id: attachmentId,
    purchaseOrderId,
    purchaseOrder: { id: purchaseOrderId, companyId: ctx.companyId },
  }) satisfies Prisma.POAttachmentWhereUniqueInput

export function loadPurchaseOrder(ctx: Scope, purchaseOrderId: string) {
  return prisma.purchaseOrder.findFirst({ where: purchaseOrderWhere(ctx, purchaseOrderId), select: { id: true } })
}

// Returns the line item's own purchaseOrderId, verified against the URL's
// purchase order and the caller's company, for follow up queries to use
export function loadPurchaseOrderLineItem(ctx: Scope, purchaseOrderId: string, lineItemId: string) {
  return prisma.pOLineItem.findFirst({
    where: purchaseOrderLineItemWhere(ctx, purchaseOrderId, lineItemId),
    select: { id: true, purchaseOrderId: true },
  })
}

export function loadPurchaseOrderAttachment(ctx: Scope, purchaseOrderId: string, attachmentId: string) {
  return prisma.pOAttachment.findFirst({
    where: purchaseOrderAttachmentWhere(ctx, purchaseOrderId, attachmentId),
    select: { id: true },
  })
}
