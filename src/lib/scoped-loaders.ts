import type { Prisma } from "@/generated/prisma"
import { mainClientLocation } from "@/lib/client-main-location"
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

// Sales and purchase orders share one view rule: the user needs the page,
// and then an order is theirs (its userId, which for an order created when
// a quote is accepted is the quote's owner) or they hold the viewAll key.
// Global Admin sees all.
type OrderViewer = Pick<AccessContext, "companyId" | "userId" | "can">

// Sales orders

// Matches no row, for callers who may not open any sales order
const NO_SALES_ORDERS = { id: { in: [] as string[] } } satisfies Prisma.SalesOrderWhereInput

// Which of the company's sales orders a user may open (VSO)
export function salesOrderVisibilityWhere(ctx: OrderViewer): Prisma.SalesOrderWhereInput {
  if (!ctx.can("pages.salesOrders")) return NO_SALES_ORDERS
  if (ctx.can("salesOrders.viewAll")) return {}
  return { userId: ctx.userId }
}

// The list filter for every sales order the user may open
export const salesOrderListWhere = (ctx: OrderViewer) =>
  ({ companyId: ctx.companyId, AND: [salesOrderVisibilityWhere(ctx)] }) satisfies Prisma.SalesOrderWhereInput

// Company scoping only, for writes after loadViewableSalesOrder has passed
export const salesOrderWhere = (ctx: Scope, salesOrderId: string) =>
  ({ id: salesOrderId, companyId: ctx.companyId }) satisfies Prisma.SalesOrderWhereUniqueInput

// One sales order the user may open, for reads that need their own include
export const viewableSalesOrderWhere = (ctx: OrderViewer, salesOrderId: string) =>
  ({
    id: salesOrderId,
    companyId: ctx.companyId,
    AND: [salesOrderVisibilityWhere(ctx)],
  }) satisfies Prisma.SalesOrderWhereUniqueInput

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

// The sales order view check (VSO) every sales order route runs on its URL
// id. An order the user can't open is a miss, same as one that doesn't exist.
export function loadViewableSalesOrder(ctx: OrderViewer, salesOrderId: string) {
  if (!ctx.can("pages.salesOrders")) return Promise.resolve(null)
  return prisma.salesOrder.findFirst({
    where: viewableSalesOrderWhere(ctx, salesOrderId),
    select: { id: true, userId: true },
  })
}

// Also selects what deleting a bundle header needs. Runs the VSO check on
// the parent order.
export function loadSalesOrderLineItem(ctx: OrderViewer, salesOrderId: string, lineItemId: string) {
  if (!ctx.can("pages.salesOrders")) return Promise.resolve(null)
  return prisma.sOLineItem.findFirst({
    where: { id: lineItemId, salesOrderId, salesOrder: viewableSalesOrderWhere(ctx, salesOrderId) },
    select: { id: true, salesOrderId: true, isBundleHeader: true, bundleName: true },
  })
}

// Runs the VSO check on the parent order
export function loadSalesOrderAttachment(ctx: OrderViewer, salesOrderId: string, attachmentId: string) {
  if (!ctx.can("pages.salesOrders")) return Promise.resolve(null)
  return prisma.sOAttachment.findFirst({
    where: { id: attachmentId, salesOrderId, salesOrder: viewableSalesOrderWhere(ctx, salesOrderId) },
    select: { id: true },
  })
}

// Quotes

type QuoteViewer = Pick<AccessContext, "companyId" | "userId" | "access" | "can">

// Matches no row, for callers who may not open any quote
const NO_QUOTES = { id: { in: [] as string[] } } satisfies Prisma.QuoteWhereInput

// Which of the company's quotes a user may open: they need the Quotes page,
// and then a quote is theirs, they see everyone's (quotes.viewAllUsersQuotes),
// or it is waiting on an approval they can decide (quotes.approve and a
// rank at or above the approval's required role). Global Admin sees all.
export function quoteVisibilityWhere(ctx: QuoteViewer): Prisma.QuoteWhereInput {
  if (!ctx.can("pages.quotes")) return NO_QUOTES
  if (ctx.can("quotes.viewAllUsersQuotes")) return {}
  const visible: Prisma.QuoteWhereInput[] = [{ userId: ctx.userId }]
  if (ctx.can("quotes.approve")) {
    visible.push({
      approvals: {
        some: { status: "PENDING", workflow: { requiredRole: { rank: { lte: ctx.access.rank } } } },
      },
    })
  }
  return { OR: visible }
}

// Who a user may make a quote's owner (the Assigned Rep on the New Quote
// form, and the assign route). A quote has no creator of its own, so the
// view rule above only knows its owner: a user who can't see everyone's
// quotes would lose sight of a quote they gave to someone else, and may
// only assign quotes to themselves. view-all holders (and Global Admin)
// may assign anyone.
export const SELF_ASSIGN_ONLY_MESSAGE = "You can only assign quotes to yourself"

export function mayAssignQuoteTo(ctx: Pick<AccessContext, "userId" | "can">, ownerId: string): boolean {
  return ownerId === ctx.userId || ctx.can("quotes.viewAllUsersQuotes")
}

// The list filter for every quote the user may open
export const quoteListWhere = (ctx: QuoteViewer) =>
  ({ companyId: ctx.companyId, AND: [quoteVisibilityWhere(ctx)] }) satisfies Prisma.QuoteWhereInput

// Company scoping only, for writes after loadViewableQuote has passed
export const quoteWhere = (ctx: Scope, quoteId: string) =>
  ({ id: quoteId, companyId: ctx.companyId }) satisfies Prisma.QuoteWhereUniqueInput

// One quote the user may open, for reads that need their own include
export const viewableQuoteWhere = (ctx: QuoteViewer, quoteId: string) =>
  ({ id: quoteId, companyId: ctx.companyId, AND: [quoteVisibilityWhere(ctx)] }) satisfies Prisma.QuoteWhereUniqueInput

// The quote view check (VQ) every quote route runs on its URL id. A quote
// the user can't open is a miss, same as one that doesn't exist.
export function loadViewableQuote(ctx: QuoteViewer, quoteId: string) {
  if (!ctx.can("pages.quotes")) return Promise.resolve(null)
  return prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, quoteId),
    select: { id: true, userId: true, status: true, quoteNumber: true },
  })
}

// Purchase orders

// Matches no row, for callers who may not open any purchase order
const NO_PURCHASE_ORDERS = { id: { in: [] as string[] } } satisfies Prisma.PurchaseOrderWhereInput

// Which of the company's purchase orders a user may open (VPO)
export function purchaseOrderVisibilityWhere(ctx: OrderViewer): Prisma.PurchaseOrderWhereInput {
  if (!ctx.can("pages.purchaseOrders")) return NO_PURCHASE_ORDERS
  if (ctx.can("purchaseOrders.viewAll")) return {}
  return { userId: ctx.userId }
}

// The list filter for every purchase order the user may open
export const purchaseOrderListWhere = (ctx: OrderViewer) =>
  ({ companyId: ctx.companyId, AND: [purchaseOrderVisibilityWhere(ctx)] }) satisfies Prisma.PurchaseOrderWhereInput

// Company scoping only, for writes after loadViewablePurchaseOrder has passed
export const purchaseOrderWhere = (ctx: Scope, purchaseOrderId: string) =>
  ({ id: purchaseOrderId, companyId: ctx.companyId }) satisfies Prisma.PurchaseOrderWhereUniqueInput

// One purchase order the user may open, for reads that need their own include
export const viewablePurchaseOrderWhere = (ctx: OrderViewer, purchaseOrderId: string) =>
  ({
    id: purchaseOrderId,
    companyId: ctx.companyId,
    AND: [purchaseOrderVisibilityWhere(ctx)],
  }) satisfies Prisma.PurchaseOrderWhereUniqueInput

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

// The purchase order view check (VPO) every purchase order route runs on
// its URL id. An order the user can't open is a miss.
export function loadViewablePurchaseOrder(ctx: OrderViewer, purchaseOrderId: string) {
  if (!ctx.can("pages.purchaseOrders")) return Promise.resolve(null)
  return prisma.purchaseOrder.findFirst({
    where: viewablePurchaseOrderWhere(ctx, purchaseOrderId),
    select: { id: true, userId: true },
  })
}

// Returns the line item's own purchaseOrderId, verified against the URL's
// purchase order, the caller's company, and the VPO check, for follow up
// queries to use. Also selects what isInventoryTrackedLine needs.
export function loadPurchaseOrderLineItem(ctx: OrderViewer, purchaseOrderId: string, lineItemId: string) {
  if (!ctx.can("pages.purchaseOrders")) return Promise.resolve(null)
  return prisma.pOLineItem.findFirst({
    where: { id: lineItemId, purchaseOrderId, purchaseOrder: viewablePurchaseOrderWhere(ctx, purchaseOrderId) },
    select: { id: true, purchaseOrderId: true, catalogItemId: true, catalogItem: { select: { type: true } } },
  })
}

// Runs the VPO check on the parent order
export function loadPurchaseOrderAttachment(ctx: OrderViewer, purchaseOrderId: string, attachmentId: string) {
  if (!ctx.can("pages.purchaseOrders")) return Promise.resolve(null)
  return prisma.pOAttachment.findFirst({
    where: { id: attachmentId, purchaseOrderId, purchaseOrder: viewablePurchaseOrderWhere(ctx, purchaseOrderId) },
    select: { id: true },
  })
}

// Opportunities

type OpportunityViewer = Pick<AccessContext, "companyId" | "userId" | "can">

// Matches no row, for callers who may not open any opportunity
const NO_OPPORTUNITIES = { id: { in: [] as string[] } } satisfies Prisma.OpportunityWhereInput

// Which of the company's opportunities a user may open (VOP). They need the
// Opportunities page, and then one of three levels:
//   basic: their own, plus unassigned ones in teams they belong to
//   opportunities.viewTeam: their own anywhere, plus every one in teams
//     they belong to
//   opportunities.viewAll: every one (Global Admin too)
// Team membership is matched in the same query (the team's members), so
// joining or leaving a team applies on the next request.
export function opportunityVisibilityWhere(ctx: OpportunityViewer): Prisma.OpportunityWhereInput {
  if (!ctx.can("pages.opportunities")) return NO_OPPORTUNITIES
  if (ctx.can("opportunities.viewAll")) return {}
  const inMyTeams: Prisma.OpportunityWhereInput = { team: { members: { some: { userId: ctx.userId } } } }
  if (ctx.can("opportunities.viewTeam")) return { OR: [{ ownerId: ctx.userId }, inMyTeams] }
  return { OR: [{ ownerId: ctx.userId }, { ownerId: null, ...inMyTeams }] }
}

// Who a user may make an opportunity's owner, given whether they are in
// the opportunity's team themselves. Unassigned (null) is always allowed.
// With opportunities.viewAll anyone; with opportunities.viewTeam anyone
// while they are in the team; otherwise only themselves. The owner must
// also be a member of the team (loadTeamMemberIds), checked separately
// with a 400.
export const OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE = "You can only assign opportunities to yourself or leave them unassigned"

export function mayAssignOpportunityTo(
  ctx: Pick<AccessContext, "userId" | "can">,
  ownerId: string | null,
  actorInTeam: boolean
): boolean {
  if (ownerId === null || ctx.can("opportunities.viewAll")) return true
  if (ctx.can("opportunities.viewTeam") && actorInTeam) return true
  return ownerId === ctx.userId
}

// Whether a user may put an opportunity in a team (choose it on create, or
// move one there): a team they belong to, or any team with viewAll
export function mayUseOpportunityTeam(ctx: Pick<AccessContext, "can">, actorInTeam: boolean): boolean {
  return actorInTeam || ctx.can("opportunities.viewAll")
}

// The list filter for every opportunity the user may open
export const opportunityListWhere = (ctx: OpportunityViewer) =>
  ({ companyId: ctx.companyId, AND: [opportunityVisibilityWhere(ctx)] }) satisfies Prisma.OpportunityWhereInput

// Company scoping only, for writes after loadViewableOpportunity has passed
export const opportunityWhere = (ctx: Scope, opportunityId: string) =>
  ({ id: opportunityId, companyId: ctx.companyId }) satisfies Prisma.OpportunityWhereUniqueInput

// One opportunity the user may open, for reads that need their own select
export const viewableOpportunityWhere = (ctx: OpportunityViewer, opportunityId: string) =>
  ({
    id: opportunityId,
    companyId: ctx.companyId,
    AND: [opportunityVisibilityWhere(ctx)],
  }) satisfies Prisma.OpportunityWhereUniqueInput

export const opportunityAttachmentWhere = (ctx: Scope, opportunityId: string, attachmentId: string) =>
  ({
    id: attachmentId,
    opportunityId,
    opportunity: { id: opportunityId, companyId: ctx.companyId },
  }) satisfies Prisma.OpportunityAttachmentWhereUniqueInput

// The opportunity view check (VOP) every opportunity route runs on its URL
// id. One the user can't open is a miss, same as one that doesn't exist.
export function loadViewableOpportunity(ctx: OpportunityViewer, opportunityId: string) {
  if (!ctx.can("pages.opportunities")) return Promise.resolve(null)
  return prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, opportunityId),
    select: { id: true, ownerId: true },
  })
}

// Runs the VOP check on the parent opportunity
export function loadOpportunityAttachment(ctx: OpportunityViewer, opportunityId: string, attachmentId: string) {
  if (!ctx.can("pages.opportunities")) return Promise.resolve(null)
  return prisma.opportunityAttachment.findFirst({
    where: { id: attachmentId, opportunityId, opportunity: viewableOpportunityWhere(ctx, opportunityId) },
    select: { id: true },
  })
}

// A timeline entry of one opportunity, company scoped, for writes after
// loadOpportunityTimelineEntry has passed
export const opportunityTimelineEntryWhere = (ctx: Scope, opportunityId: string, entryId: string) =>
  ({ id: entryId, companyId: ctx.companyId, opportunityId }) satisfies Prisma.TimelineEntryWhereUniqueInput

// A timeline entry by its URL id (or a paging cursor), only under the
// opportunity it belongs to, with the VOP check on that opportunity
export function loadOpportunityTimelineEntry(ctx: OpportunityViewer, opportunityId: string, entryId: string) {
  if (!ctx.can("pages.opportunities")) return Promise.resolve(null)
  return prisma.timelineEntry.findFirst({
    where: { id: entryId, companyId: ctx.companyId, opportunityId, opportunity: viewableOpportunityWhere(ctx, opportunityId) },
    select: { id: true, kind: true, authorId: true },
  })
}

// The id of a client's main location (mainClientLocation: its primary
// location, else its main billing location), or null when it has none or
// the client isn't this company's. The default location of an opportunity.
export async function loadClientMainLocationId(ctx: Scope, clientId: string): Promise<string | null> {
  const location = { select: { id: true, name: true, isPrimary: true } }
  const client = await prisma.client.findFirst({
    where: clientWhere(ctx, clientId),
    select: { locations: { where: { isPrimary: true }, ...location }, mainBillingLocation: location },
  })
  return client ? (mainClientLocation(client)?.id ?? null) : null
}

export const opportunityStageWhere = (ctx: Scope, stageId: string) =>
  ({ id: stageId, companyId: ctx.companyId }) satisfies Prisma.OpportunityStageWhereUniqueInput

export const opportunityTypeWhere = (ctx: Scope, typeId: string) =>
  ({ id: typeId, companyId: ctx.companyId }) satisfies Prisma.OpportunityTypeWhereUniqueInput

// Teams (shared by opportunities now and tickets later)

export const teamWhere = (ctx: Scope, teamId: string) =>
  ({ id: teamId, companyId: ctx.companyId }) satisfies Prisma.TeamWhereUniqueInput

// A team of the caller's company, for routes with a team id in the URL
export function loadTeam(ctx: Scope, teamId: string) {
  return prisma.team.findFirst({ where: teamWhere(ctx, teamId), select: { id: true, isDefault: true } })
}

// Which of these users are members of the team (a team of the caller's
// company; another company's team has no members here). null and repeated
// ids are skipped.
export async function loadTeamMemberIds(ctx: Scope, teamId: string, userIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return new Set()
  const rows = await prisma.teamMember.findMany({
    where: { teamId, userId: { in: ids }, team: { companyId: ctx.companyId } },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId))
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
  // A sales order the caller may open (the VSO rule), for a body that
  // links to one. Needs a ctx with userId and can; without them it never
  // passes.
  viewableSalesOrderId?: unknown
  // Contact tags
  tagIds?: unknown
  // Containers
  inventoryLocationId?: unknown
  opportunityStageId?: unknown
  opportunityTypeId?: unknown
  // Teams of the company (one id or a list)
  teamId?: unknown
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
  viewableSalesOrderId: "sales order",
  tagIds: "tag",
  inventoryLocationId: "container",
  opportunityStageId: "stage",
  opportunityTypeId: "opportunity type",
  teamId: "team",
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
// Every caller passes its full AccessContext; only the keys that apply a
// view rule (viewableSalesOrderId) read userId and can
type RefScope = Scope & Partial<Pick<AccessContext, "userId" | "can">>

function countRefs(ctx: RefScope, key: RefKey, ids: string[], clientId?: string, vendorId?: string) {
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
    case "viewableSalesOrderId": {
      const { userId, can } = ctx
      if (!userId || !can) return Promise.resolve(0)
      if (!can("pages.salesOrders")) return Promise.resolve(0)
      return prisma.salesOrder.count({ where: whereIds(viewableSalesOrderWhere({ ...ctx, userId, can }, first), ids) })
    }
    case "tagIds":
      return prisma.contactTag.count({ where: whereIds(contactTagWhere(ctx, first), ids) })
    case "inventoryLocationId":
      return prisma.inventoryLocation.count({ where: whereIds(inventoryLocationWhere(ctx, first), ids) })
    case "opportunityStageId":
      return prisma.opportunityStage.count({ where: whereIds(opportunityStageWhere(ctx, first), ids) })
    case "opportunityTypeId":
      return prisma.opportunityType.count({ where: whereIds(opportunityTypeWhere(ctx, first), ids) })
    case "teamId":
      return prisma.team.count({ where: whereIds(teamWhere(ctx, first), ids) })
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
export async function assertRefs(ctx: RefScope, refs: BodyRefs) {
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
