import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"

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

// Company level records

export const industryWhere = (ctx: Scope, industryId: string) =>
  ({ id: industryId, companyId: ctx.companyId }) satisfies Prisma.IndustryWhereUniqueInput

export const roleWhere = (ctx: Scope, roleId: string) =>
  ({ id: roleId, companyId: ctx.companyId }) satisfies Prisma.RoleWhereUniqueInput

export const userWhere = (ctx: Scope, userId: string) =>
  ({ id: userId, companyId: ctx.companyId }) satisfies Prisma.UserWhereUniqueInput

export const activeUserWhere = (ctx: Scope, userId: string) =>
  ({ id: userId, companyId: ctx.companyId, active: true }) satisfies Prisma.UserWhereUniqueInput

export const contactTagWhere = (ctx: Scope, tagId: string) =>
  ({ id: tagId, companyId: ctx.companyId }) satisfies Prisma.ContactTagWhereUniqueInput

export const inventoryCustomFieldWhere = (ctx: Scope, customFieldId: string) =>
  ({ id: customFieldId, companyId: ctx.companyId }) satisfies Prisma.InventoryCustomFieldWhereUniqueInput

export const inventoryLocationWhere = (ctx: Scope, inventoryLocationId: string) =>
  ({ id: inventoryLocationId, companyId: ctx.companyId }) satisfies Prisma.InventoryLocationWhereUniqueInput

// Ids that arrive in a request body

// Ids a request body points at, checked by assertRefs. Each key takes one
// id or a list of ids. null, undefined, and "" are skipped, so optional
// fields and fields being cleared keep working.
export interface BodyRefs {
  clientId?: unknown
  // Contacts of clientId when it's given, otherwise of any company client
  contactId?: unknown
  // Locations of clientId when it's given, otherwise of any company client
  clientLocationId?: unknown
  vendorId?: unknown
  // Locations of vendorId when it's given, otherwise of any company vendor
  vendorLocationId?: unknown
  // Manufacturers are Vendor rows
  manufacturerId?: unknown
  catalogItemId?: unknown
  industryId?: unknown
  roleId?: unknown
  // Active users of the company
  userId?: unknown
  // Any user of the company, active or not, for saved settings that may
  // still point at someone deactivated since
  companyUserId?: unknown
  customFieldId?: unknown
  salesOrderId?: unknown
  // Contact tags
  tagIds?: unknown
  // Containers
  inventoryLocationId?: unknown
}

type RefKey = keyof BodyRefs

// Also the order refs are checked in, parents first, so a bad client is
// reported as the client rather than as its contact
const REF_LABELS: Record<RefKey, string> = {
  clientId: "client",
  vendorId: "vendor",
  contactId: "contact",
  clientLocationId: "location",
  vendorLocationId: "location",
  manufacturerId: "manufacturer",
  catalogItemId: "catalog item",
  industryId: "industry",
  roleId: "role",
  userId: "user",
  companyUserId: "user",
  customFieldId: "custom field",
  salesOrderId: "sales order",
  tagIds: "tag",
  inventoryLocationId: "container",
}

// Turns a single id *Where builder's clause into one matching every id in
// the list, so assertRefs keeps exactly the builder's scoping
function whereIds<W extends { id: string }>(where: W, ids: string[]) {
  return { ...where, id: { in: ids } }
}

// The distinct ids in a body value, or null when it holds something that
// isn't an id at all (a number, an object, a list of those)
function readIds(value: unknown): string[] | null {
  const ids: string[] = []
  for (const v of Array.isArray(value) ? value : [value]) {
    if (v === null || v === undefined || v === "") continue
    if (typeof v !== "string") return null
    ids.push(v)
  }
  return [...new Set(ids)]
}

// How many of the ids exist within the caller's company (and parent, where
// the ref has one). Valid when that equals the number of distinct ids.
function countRefs(ctx: Scope, key: RefKey, ids: string[], clientId?: string, vendorId?: string) {
  const [first] = ids
  const company = { companyId: ctx.companyId }
  switch (key) {
    case "clientId":
      return prisma.client.count({ where: whereIds(clientWhere(ctx, first), ids) })
    case "contactId":
      return prisma.contact.count({
        where: clientId ? whereIds(clientContactWhere(ctx, clientId, first), ids) : { id: { in: ids }, client: company },
      })
    case "clientLocationId":
      return prisma.clientLocation.count({
        where: clientId ? whereIds(clientLocationWhere(ctx, clientId, first), ids) : { id: { in: ids }, client: company },
      })
    case "vendorId":
    case "manufacturerId":
      return prisma.vendor.count({ where: whereIds(vendorWhere(ctx, first), ids) })
    case "vendorLocationId":
      return prisma.vendorLocation.count({
        where: vendorId ? whereIds(vendorLocationWhere(ctx, vendorId, first), ids) : { id: { in: ids }, vendor: company },
      })
    case "catalogItemId":
      return prisma.catalogItem.count({ where: whereIds(catalogItemWhere(ctx, first), ids) })
    case "industryId":
      return prisma.industry.count({ where: whereIds(industryWhere(ctx, first), ids) })
    case "roleId":
      return prisma.role.count({ where: whereIds(roleWhere(ctx, first), ids) })
    case "userId":
      return prisma.user.count({ where: whereIds(activeUserWhere(ctx, first), ids) })
    case "companyUserId":
      return prisma.user.count({ where: whereIds(userWhere(ctx, first), ids) })
    case "customFieldId":
      return prisma.inventoryCustomField.count({ where: whereIds(inventoryCustomFieldWhere(ctx, first), ids) })
    case "salesOrderId":
      return prisma.salesOrder.count({ where: whereIds(salesOrderWhere(ctx, first), ids) })
    case "tagIds":
      return prisma.contactTag.count({ where: whereIds(contactTagWhere(ctx, first), ids) })
    case "inventoryLocationId":
      return prisma.inventoryLocation.count({ where: whereIds(inventoryLocationWhere(ctx, first), ids) })
  }
}

// Checks every id a request body points at against the caller's company,
// with one count query per kind of record (never one per id). Returns null
// when they're all valid, or a 400 naming the first bad field, worded the
// same whether the id is made up or belongs to another company:
//   const invalid = await assertRefs(ctx, { clientId: body.clientId, contactId: body.contactId })
//   if (invalid) return invalid
// contactId and clientLocationId are tied to clientId, and vendorLocationId
// to vendorId, when that parent is a single id.
export async function assertRefs(ctx: Scope, refs: BodyRefs) {
  const clientId = typeof refs.clientId === "string" && refs.clientId ? refs.clientId : undefined
  const vendorId = typeof refs.vendorId === "string" && refs.vendorId ? refs.vendorId : undefined

  const checks: { key: RefKey; ids: string[] | null }[] = []
  for (const key of Object.keys(REF_LABELS) as RefKey[]) {
    if (!(key in refs)) continue
    const ids = readIds(refs[key])
    if (ids === null || ids.length > 0) checks.push({ key, ids })
  }

  const counts = await Promise.all(
    checks.map(({ key, ids }) => (ids ? countRefs(ctx, key, ids, clientId, vendorId) : Promise.resolve(-1)))
  )

  const failed = checks.find(({ ids }, i) => !ids || counts[i] !== ids.length)
  return failed ? apiError(400, `Invalid ${REF_LABELS[failed.key]}`, "INVALID_REFERENCE") : null
}
