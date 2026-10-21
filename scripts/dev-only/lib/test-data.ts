// Names and constants shared by the dev-only checks. Every record a run
// creates is named from testNames(letter, marker), so each name, email,
// and label carries the run's marker (lib/run-data.ts) and can never be
// mistaken for real data or for another run's.
//
// No database imports here, so loading this file never touches the database.

import { randomInt } from "crypto"

export type TestLetter = "B" | "C"
export const TEST_LETTERS: readonly TestLetter[] = ["B", "C"]

// Same cost factor the app uses for every password it stores
export const BCRYPT_COST = 10

export function testNames(letter: TestLetter, marker: string) {
  const lower = letter.toLowerCase()
  const email = (who: string) => `${marker}-${who}-${lower}@example.test`
  return {
    company: `${marker} Test Company ${letter}`,
    adminName: `${marker} Test Admin ${letter}`,
    adminEmail: email("admin"),
    industry: `${marker} Sample Industry ${letter}`,
    contactTag: `${marker} Sample Tag ${letter}`,
    client: `${marker} Sample Client ${letter}`,
    clientPrefix: `TC${letter}`,
    clientLocation: `${marker} Sample Location ${letter}`,
    clientLocationAddress: "1 Sample Street",
    clientLocationCity: "Sampleton",
    // "Sample" stays as is: the contact search check looks for it
    contactFirstName: "Sample",
    contactLastName: `Contact ${letter} ${marker}`,
    contactEmail: email("sample-contact"),
    vendor: `${marker} Sample Vendor ${letter}`,
    vendorLocation: `${marker} Sample Vendor Location ${letter}`,
    vendorContactFirstName: "Sample",
    vendorContactLastName: `Vendor Contact ${letter} ${marker}`,
    vendorAttachment: `${marker}-sample-vendor-${lower}.txt`,
    category: `${marker} Sample Category ${letter}`,
    customField: `${marker} Sample Field ${letter}`,
    catalogItem: `${marker} Sample Item ${letter}`,
    quote: `${marker} Sample Quote ${letter}`,
    quoteLine: `${marker} Sample Quote Line ${letter}`,
    template: `${marker} Sample Template ${letter}`,
    salesOrder: `${marker} Sample Sales Order ${letter}`,
    soLine: `${marker} Sample SO Line ${letter}`,
    soComment: `${marker} Sample SO comment ${letter}`,
    soAttachment: `${marker}-sample-so-${lower}.txt`,
    purchaseOrder: `${marker} Sample Purchase Order ${letter}`,
    purchaseOrder2: `${marker} Sample Purchase Order ${letter} (second)`,
    poLine: `${marker} Sample PO Line ${letter}`,
    poComment: `${marker} Sample PO comment ${letter}`,
    poAttachment: `${marker}-sample-po-${lower}.txt`,
    assetSerial: `${marker}-SAMPLE-${letter}-0001`,
    assetAttachment: `${marker}-sample-asset-${lower}.txt`,
    workflow: `${marker} Sample Workflow ${letter}`,
    // Only created by the cross company check, for the role escalation attempt
    limitedRole: `${marker} Test Limited Role ${letter}`,
    targetRole: `${marker} Test Target Role ${letter}`,
    limitedUserName: `${marker} Test Limited ${letter}`,
    limitedUserEmail: email("limited"),
    // Permission test users. Everyone holds only the Everyone role; Rep
    // holds the Rep role below.
    everyoneName: `${marker} Test Everyone ${letter}`,
    everyoneEmail: email("everyone"),
    repName: `${marker} Test Rep ${letter}`,
    repEmail: email("rep"),
    repRole: `${marker} Rep ${letter}`,
    repQuote: `${marker} Sample Rep Quote ${letter}`,
    repQuoteLine: `${marker} Sample Rep Quote Line ${letter}`,
    // Clerk holds the Clerk role below, plus a sales order and purchase
    // order of its own so the "only your own" filters can be seen
    clerkName: `${marker} Test Clerk ${letter}`,
    clerkEmail: email("clerk"),
    clerkRole: `${marker} Clerk ${letter}`,
    clerkSalesOrder: `${marker} Sample Clerk Sales Order ${letter}`,
    clerkSoLine: `${marker} Sample Clerk SO Line ${letter}`,
    clerkPurchaseOrder: `${marker} Sample Clerk Purchase Order ${letter}`,
    // Pooled stock needs a catalog item that isn't serialized, held in a
    // container under the sample client location
    stockItem: `${marker} Sample Stock Item ${letter}`,
    container: `${marker} Sample Container ${letter}`,
    // A mailbox row with placeholder tokens, never usable to send anything
    adminMailboxEmail: email("admin-mailbox"),
    adminMailboxLabel: `${marker} Sample Mailbox ${letter}`,
    // Only created by the permission check, for the sender checks
    senderRole: `${marker} Test Sender Role ${letter}`,
    senderName: `${marker} Test Sender ${letter}`,
    senderEmail: email("sender"),
    senderMailboxEmail: email("sender-mailbox"),
    // Orders holds the Orders role below, plus a sales order and purchase
    // order of its own (each with a line), so the view rules can be seen
    ordersName: `${marker} Test Orders ${letter}`,
    ordersEmail: email("orders"),
    ordersRole: `${marker} Orders ${letter}`,
    ordersSalesOrder: `${marker} Sample Orders Sales Order ${letter}`,
    ordersSoLine: `${marker} Sample Orders SO Line ${letter}`,
    ordersPurchaseOrder: `${marker} Sample Orders Purchase Order ${letter}`,
    ordersPoLine: `${marker} Sample Orders PO Line ${letter}`,
    // Templater holds the Templater role below, and edits this template for
    // the line item cost checks
    templaterName: `${marker} Test Templater ${letter}`,
    templaterEmail: email("templater"),
    templaterRole: `${marker} Templater ${letter}`,
    costTemplate: `${marker} Sample Cost Template ${letter}`,
    costTemplateLine: `${marker} Sample Cost Template Line ${letter}`,
    // Only created by the permission check: sees every sales order and
    // purchase order but edits none, so it can't see cost
    viewerRole: `${marker} Test Viewer Role ${letter}`,
    viewerName: `${marker} Test Viewer ${letter}`,
    viewerEmail: email("viewer"),
    // Only created by the permission check: manages users without being a
    // Global Admin, for the invite rank rule
    managerRole: `${marker} Test Manager Role ${letter}`,
    managerName: `${marker} Test Manager ${letter}`,
    managerEmail: email("manager"),
    // Only created by the permission check, and removed at the end: an ad
    // hoc (not inventory tracked) line on Test Orders' purchase order
    untrackedPoLine: `${marker} Dev Check Untracked Line ${letter}`,
    // Only created by the permission check: decides approvals (pages.quotes
    // and quotes.approve) without being a Global Admin, for the approval
    // re-check
    approverRole: `${marker} Test Approver Role ${letter}`,
    approverName: `${marker} Test Approver ${letter}`,
    approverEmail: email("approver"),
    // The quote copy checks: a second client with its own contact, payment
    // terms, and shipping location, so a copy can be made for a different
    // client and a contact of the wrong client can be refused, and an admin
    // quote with every kind of line (a bundle, a choice group with a
    // selected option, a text block, an optional line, an adjustable
    // quantity, a recurring line) over two sections and an empty one
    copyClient: `${marker} Sample Copy Client ${letter}`,
    copyClientLocation: `${marker} Sample Copy Location ${letter}`,
    copyClientPaymentTerms: "Net45",
    copyContactFirstName: "Copy",
    copyContactLastName: `Contact ${letter} ${marker}`,
    copyQuote: `${marker} Sample Copy Quote ${letter}`,
    // Each fixture line is named this prefix, a space, and what it is
    copyLinePrefix: `${marker} Sample Copy Line ${letter}:`,
  }
}

export type TestNames = ReturnType<typeof testNames>

// The sample catalog item's cost, so the line item cost checks know what
// the stored cost must be
export const SAMPLE_ITEM_COST = 60

// Stored in place of real Microsoft tokens on the sample mailbox rows. The
// test companies have no Microsoft credentials either, so nothing can ever
// be sent from them.
export const PLACEHOLDER_TOKEN = "dev-only-not-a-real-token"

// Rep: the quotes page and creating and editing quotes, nothing else
export const REP_PERMISSIONS = { pages: { quotes: true }, quotes: { create: true, edit: true } }

// Clerk: the Clients, Vendors, Catalog, and Inventory pages, and creating and
// editing clients, nothing else (no settings, no deletes)
export const CLERK_PERMISSIONS = {
  pages: { clients: true, vendors: true, catalog: true, inventory: true },
  clients: { create: true, edit: true },
}

// Orders: the Sales Orders and Purchase Orders pages, creating and editing
// both, nothing else (no viewAll, no generatePO, no status, no deletes)
export const ORDERS_PERMISSIONS = {
  pages: { salesOrders: true, purchaseOrders: true },
  salesOrders: { create: true, edit: true },
  purchaseOrders: { create: true, edit: true },
}

// Templater: Quote Settings only, which maintains quote templates. Holds
// none of the cost permissions, so it can't see or set cost.
export const TEMPLATER_PERMISSIONS = { settingsSections: { quotes: true } }

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

// Node crypto, never Math.random. Kept in memory only, never printed.
export function generatePassword(length = 24): string {
  let out = ""
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return out
}

// Attachment rows only point here. Nothing is ever uploaded to S3.
export const DUMMY_FILE_URL = "https://example.test/dev-only-sample.txt"

export interface SampleIds {
  companyId: string
  adminId: string
  globalAdminRoleId: string
  everyoneRoleId: string
  industryId: string
  contactTagId: string
  clientId: string
  clientLocationId: string
  contactId: string
  vendorId: string
  vendorLocationId: string
  vendorContactId: string
  vendorAttachmentId: string
  categoryId: string
  customFieldId: string
  catalogItemId: string
  quoteId: string
  quoteLineId: string
  templateId: string
  salesOrderId: string
  soLineId: string
  soCommentId: string
  soAttachmentId: string
  purchaseOrderId: string
  purchaseOrder2Id: string
  poLineId: string
  poCommentId: string
  poAttachmentId: string
  assetId: string
  assetAttachmentId: string
  workflowId: string
}

export interface PermissionFixtureIds {
  everyoneUserId: string
  repUserId: string
  repRoleId: string
  repQuoteId: string
  repQuoteLineId: string
  adminMailboxId: string
  clerkUserId: string
  clerkRoleId: string
  clerkSalesOrderId: string
  clerkPurchaseOrderId: string
  stockItemId: string
  containerId: string
  stockId: string
  ordersUserId: string
  ordersRoleId: string
  ordersSalesOrderId: string
  ordersSoLineId: string
  ordersPurchaseOrderId: string
  ordersPoLineId: string
  templaterUserId: string
  templaterRoleId: string
  costTemplateId: string
  costTemplateLineId: string
  copyClientId: string
  copyContactId: string
  copyQuoteId: string
}
