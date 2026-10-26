// DEV ONLY. Proves the permission checks inside one company against the
// locally running dev server: signs in as Test Admin B (Global Admin), Test
// Rep B (only the Rep role), Test Clerk B (only the Clerk role), Test Orders
// B (only the Orders role), Test Templater B (only the Templater role), and
// Test Everyone B (only the Everyone role, with no permissions), all made by
// this run (lib/run-data.ts), plus Test Sender B, Test Viewer B, and Test
// Manager B users this script sets up itself, and checks every attempt in
// the ATTEMPTS list below. It also adds an ad hoc line to Test Orders B's
// purchase order for the received flag checks and removes it at the end.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts), and only
// talks to a server on this machine. Run from the repo root, with the dev
// server running:
//   npx tsx scripts/dev-only/check-permissions.ts --yes
// Optional: --base-url http://localhost:3000 (the default)
// On its own it sets up and removes its own temporary data; run-checks.ts
// runs it with the data it shares between all three checks.
//
// Order of work: guard, safety checks, sign in, every positive control (if
// any fails the harness itself is broken and nothing else runs), then every
// other attempt, then the shared sender mode attempts. Quote Settings is
// put in creator mode for the run, switched to a shared mailbox for the
// shared mode attempts, and put back the way it was at the end. Any FAIL or
// UNEXPECTED exits 1, a broken harness exits 2.
//
// No real email is ever sent and no real distributor is reached: the test
// companies have no Microsoft credentials and no distributor integration
// turned on (findExternalServices, checked before anything runs), and no
// attempt tests a distributor connection. Their mailbox rows hold
// placeholder tokens, and every send-email attempt is one that must be
// refused before any mail would go out. The success path of the sender
// rules is checked through send-options instead.
//
// The step checkHeldEmailApproval holds an email for approval and
// approves it. With no Microsoft credentials the held email can't be sent,
// which is exactly the failed send it checks: the approval stands, the
// quote returns to DRAFT with the email kept, and nothing is sent twice.
// Everything it changes is put back afterwards.
//
// The round two steps after it: checkStatusApproval switches the sample
// workflow on and checks that Test Admin B can't move the draft sample
// quote to SENT or ACCEPTED through the status route (DECLINED works), and
// can with the workflow off. checkStaleApproval has Test Admin B request
// approval with an email (never sent, no credentials), change a line price,
// and Test Approver B (made by this script: the Quotes page and approving,
// not a Global Admin) approve it, which must not send it: the quote goes
// back to DRAFT with the email kept and the approvals no longer counting.
// checkSalesOrderLinkedPurchaseOrders links Test Admin B's second sample
// purchase order to Test Orders B's sales order and checks Orders B can't
// see it there. Each step puts the quote, the workflow, the line price,
// the purchase order link, and any notification it made back.
//
// Quote correctness: checkQuoteCopy has Test Admin B copy the copy fixture
// quote (lib/run-data.ts: a bundle, a choice group with a selected
// option, a text block, an optional line, an adjustable quantity, and a
// recurring line over two sections and an empty one) for the copy client,
// then copy that copy, and Test Rep B copy its own quote. Each copy must
// have the same lines and sections, the chosen client and contact, and the
// copier as its owner, and none of the original's PO number, internal
// notes, or progress. Every copy is deleted afterwards. The refusals cover
// a copy without a client or contact, another company's client or contact,
// a contact of a different client, assigning a quote to someone else
// without quotes.viewAllUsersQuotes, and blank, 0, negative, and
// fractional Default Expiry values.
//
// Opportunities: Test Everyone B is refused every opportunity, stage,
// type, and settings route. Test Rep B (a second role with the
// Opportunities page and create, no see all) sees only its own and the
// unassigned sample opportunity, gets a 404 on the admin's, a 403 naming
// the admin as owner, and may create for itself or unassigned (each
// created row is removed right after). Test Opp Viewer B (only the page)
// reads but can't create, edit, or delete, and Test Opp Settings B (only
// Opportunity Settings) is the only one besides Global Admin whose stage,
// type, and settings writes go through.
//
// Opportunities screens: checkOpportunityPages reads the Opportunities
// page, an opportunity's page, and Settings > Opportunity Settings as HTML
// with each user's session (Test Everyone B, Test Clerk B, and Test Opp
// Settings B get no access to the opportunity pages; Test Everyone B, Test
// Opp Viewer B, and Test Manager B, who opens Settings, to the section).
// checkRelatedVisibility links the admin's sample quote and Test Rep B's
// quote to the unassigned sample opportunity and checks the Related panel
// lists only the ones each user may open, then unlinks them.
// checkStageCategoryClosedAt has Test Opp Settings B move the first stage
// to WON and back, checking closedAt is set and then cleared on the sample
// opportunities in it, and puts the stage and dates back.
//
// Timeline: every timeline route is refused for Test Everyone B, reading
// needs the Opportunities page and the opportunity view check, and adding a
// note needs opportunities.edit (Test Rep B and Test Opp Viewer B are
// refused). Test Admin B, a Global Admin, still can't edit or delete Test
// Rep B's sample note, and nobody can edit or delete an action entry.
// checkTimeline has Test Admin B add a note holding a script tag (stored
// and returned without it), edit and delete it, and checks that a stage
// change through PATCH adds exactly one stage_changed entry and a PATCH
// that changes nothing adds none, then puts everything back.
// checkNoteStageChange posts notes with a stageId (to a WON stage, then an
// OPEN one), checking the stage moves, closedAt is set and cleared, and each
// adds exactly one entry, the note holding the move. A note with a stageId
// is refused without opportunities.edit, and with another company's, a made
// up, or a non text stageId. The opportunity GET's client details reach
// only users who may open it, and the list never carries them.

import { Prisma, type PrismaClient } from "@/generated/prisma"
import { enforceDevGuard, findExternalServices } from "./lib/guard"
import { PLACEHOLDER_TOKEN, SAMPLE_ITEM_COST, type PermissionFixtureIds, type SampleIds, type TestNames } from "./lib/test-data"
import { HarnessBroken, ServerUnreachable, Session, checkResult, errorText, isJsonError, printTable, readBaseUrl, type CheckResult, type Method, type Row } from "./lib/harness"
import { addRunMailbox, addRunRole, addRunUser, isEntryScript, withRunData, type RunData } from "./lib/run-data"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("check-permissions")

// ─── ATTEMPTS ────────────────────────────────────────────────────────────────
// Every permission attempt, in one list. To cover more routes in a later
// branch, add entries here.
//
//   actor        who makes the request: admin (Test Admin B, Global Admin),
//                rep (Test Rep B), clerk (Test Clerk B), everyone (Test
//                Everyone B), orders (Test Orders B), templater (Test
//                Templater B), sender
//                (Test Sender B: pages.quotes, quotes.sendEmail, and
//                quotes.viewAllUsersQuotes, made by this script, with a
//                mailbox of its own), viewer (Test Viewer B: both order
//                pages and both viewAll keys, no edit, made by this script),
//                manager (Test Manager B: settingsSections.users only,
//                not a Global Admin, made by this script), oppViewer
//                (Test Opp Viewer B: only the Opportunities page), or
//                oppSettings (Test Opp Settings B: only Opportunity
//                Settings). Test Rep B also holds the Opportunities page
//                and opportunities.create, without see all.
//   kind         control: must succeed, and if it doesn't the harness is
//                broken and nothing else runs. allowed: must succeed.
//                refused: must be refused with exactly expect, and must not
//                change any data.
//   expect       the status: 200, 307 (a redirect the route answers with),
//                400, 403 (missing permission), or 404 (a record the user
//                may not open)
//   expectError  text a refusal must contain, so a refusal for some other
//                reason can't pass
//   location     text a 307 redirect's Location must contain
//   contains / notContains   text the response must or must not include
//   check        extra checks on a successful JSON response, returning a
//                problem or null
//   sharedMode   runs with Quote Settings set to send every quote from Test
//                Admin B's mailbox ("admin") or Test Sender B's ("sender")

type Actor = "admin" | "rep" | "clerk" | "everyone" | "sender" | "orders" | "templater" | "viewer" | "manager" | "oppViewer" | "oppSettings"

interface AttemptContext {
  b: SampleIds
  c: SampleIds
  fx: PermissionFixtureIds
  fxC: PermissionFixtureIds
  names: TestNames
  // Test Company C's names, for the invite of another company's email
  namesC: TestNames
  senderMailboxId: string
  repUserId: string
  // Test Manager B's own role, and the ad hoc purchase order line this
  // script adds (both from the fixtures below)
  managerRoleId: string
  untrackedPoLineId: string
  // A made up id, for routes that check the permission before the record
  fakeId: string
}

interface Attempt {
  name: string
  actor: Actor
  kind: "control" | "allowed" | "refused"
  method: Method
  path: (c: AttemptContext) => string
  body?: (c: AttemptContext) => unknown
  expect: 200 | 307 | 400 | 403 | 404
  expectError?: string
  location?: string
  contains?: (c: AttemptContext) => string[]
  notContains?: (c: AttemptContext) => string[]
  check?: (json: unknown, c: AttemptContext, prisma: PrismaClient) => Promise<string | null> | string | null
  sharedMode?: "admin" | "sender"
}

// A complete send-email body, so a send attempt can only be refused for
// the reason under test. Never sent: see the note at the top.
const sendBody = (extra: Record<string, unknown> = {}) => ({
  to: "nobody@example.test",
  subject: "Dev only check, never sent",
  message: "Dev only check, never sent",
  includePdf: false,
  ...extra,
})

const NO_TOKENS = () => [PLACEHOLDER_TOKEN, "accessToken", "refreshToken"]

interface SendOptionsJson {
  defaultConnectionId: string | null
  canChooseSender: boolean
  options: { connectionId: string; email: string; isShared: boolean }[]
}

function sendOptions(json: unknown): SendOptionsJson {
  return json as SendOptionsJson
}

// Every guarded route for clients, catalog, vendors, company settings lists,
// and inventory. Test Everyone B and Test Rep B hold none of these
// permissions, so each one is refused for both with a 403 before any record
// is looked up. clerk marks the ones Test Clerk B is refused too (settings,
// deletes, and Remove). Writes carry a body that would change data if the
// check were missing, so the snapshot catches a leak.
interface Guarded {
  name: string
  method: Method
  path: (c: AttemptContext) => string
  body?: (c: AttemptContext) => unknown
  expectError: string
  clerk?: true
}

const GUARDED: Guarded[] = [
  // Clients and contacts
  { name: "Create a client", method: "POST", path: () => "/api/clients", body: () => ({ name: "Should Not Exist" }), expectError: "create clients" },
  { name: "Import clients", method: "POST", path: () => "/api/clients/import", body: () => ({ rows: [{ name: "Should Not Exist" }] }), expectError: "create clients" },
  { name: "Edit a client", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}`, body: () => ({ name: "Changed" }), expectError: "edit clients" },
  { name: "Add a client contact", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expectError: "edit clients" },
  { name: "Edit a client contact", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}/contacts/${c.b.contactId}`, body: () => ({ firstName: "Changed" }), expectError: "edit clients" },
  { name: "Add a client location", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/locations`, body: () => ({ name: "Should Not Exist" }), expectError: "edit clients" },
  { name: "Edit a client location", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}/locations/${c.b.clientLocationId}`, body: () => ({ name: "Changed" }), expectError: "edit clients" },
  { name: "Client assets", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/assets`, expectError: "view inventory" },
  { name: "Onboard a client for inventory", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/onboard-inventory`, body: () => ({ prefix: "NOPE" }), expectError: "onboard clients for inventory" },
  { name: "Set a site's default container", method: "PATCH", path: (c) => `/api/client-locations/${c.b.clientLocationId}/default-container`, body: (c) => ({ containerId: c.fx.containerId }), expectError: "edit inventory" },

  // Catalog
  { name: "Create a catalog item", method: "POST", path: () => "/api/catalog", body: (c) => ({ name: "Should Not Exist", categoryId: c.b.categoryId }), expectError: "edit the catalog" },
  { name: "Open a catalog item", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expectError: "view the catalog" },
  { name: "Edit a catalog item", method: "PATCH", path: (c) => `/api/catalog/${c.b.catalogItemId}`, body: (c) => ({ name: "Changed", categoryId: c.b.categoryId }), expectError: "edit the catalog" },
  { name: "Delete a catalog item", method: "DELETE", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expectError: "delete catalog items", clerk: true },
  { name: "Catalog change log", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/change-log`, expectError: "view the catalog" },
  { name: "Catalog order history", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`, expectError: "view the catalog" },

  // Vendors
  { name: "Create a vendor", method: "POST", path: () => "/api/vendors", body: () => ({ name: "Should Not Exist" }), expectError: "edit vendors" },
  { name: "Open a vendor", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}`, expectError: "view vendors" },
  { name: "Edit a vendor", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}`, body: () => ({ name: "Changed" }), expectError: "edit vendors" },
  { name: "Vendor attachments", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expectError: "view vendors" },
  { name: "Upload a vendor attachment", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expectError: "edit vendors" },
  { name: "Delete a vendor attachment", method: "DELETE", path: (c) => `/api/vendors/${c.b.vendorId}/attachments/${c.b.vendorAttachmentId}`, expectError: "edit vendors" },
  { name: "Add a vendor contact", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expectError: "edit vendors" },
  { name: "Edit a vendor contact", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}/contacts/${c.b.vendorContactId}`, body: () => ({ firstName: "Changed" }), expectError: "edit vendors" },
  { name: "Add a vendor location", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/locations`, body: () => ({ name: "Should Not Exist" }), expectError: "edit vendors" },
  { name: "Edit a vendor location", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}/locations/${c.b.vendorLocationId}`, body: () => ({ name: "Changed" }), expectError: "edit vendors" },
  { name: "Upload a vendor logo", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/logo`, expectError: "edit vendors" },
  { name: "Remove a vendor logo", method: "DELETE", path: (c) => `/api/vendors/${c.b.vendorId}/logo`, expectError: "edit vendors" },
  { name: "Vendor purchase orders", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`, expectError: "view vendors" },

  // Categories, industries, contact tags, custom fields (Company settings)
  { name: "Create a category", method: "POST", path: () => "/api/categories", body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a category", method: "PATCH", path: (c) => `/api/categories/${c.b.categoryId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a category", method: "DELETE", path: (c) => `/api/categories/${c.b.categoryId}`, expectError: "manage company settings", clerk: true },
  { name: "A category's custom fields", method: "GET", path: (c) => `/api/categories/${c.b.categoryId}/custom-fields`, expectError: "manage company settings", clerk: true },
  { name: "Add a custom field", method: "POST", path: (c) => `/api/categories/${c.b.categoryId}/custom-fields`, body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a custom field", method: "PATCH", path: (c) => `/api/inventory-custom-fields/${c.b.customFieldId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a custom field", method: "DELETE", path: (c) => `/api/inventory-custom-fields/${c.b.customFieldId}`, expectError: "manage company settings", clerk: true },
  { name: "Add an industry", method: "POST", path: () => "/api/industries", body: () => ({ name: "Should Not Exist" }), expectError: "add industries" },
  { name: "Delete an industry", method: "DELETE", path: (c) => `/api/industries/${c.b.industryId}`, expectError: "manage company settings", clerk: true },
  { name: "Create a contact tag", method: "POST", path: () => "/api/contact-tags", body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a contact tag", method: "PATCH", path: (c) => `/api/contact-tags/${c.b.contactTagId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a contact tag", method: "DELETE", path: (c) => `/api/contact-tags/${c.b.contactTagId}`, expectError: "manage company settings", clerk: true },

  // Inventory
  { name: "List inventory assets", method: "GET", path: () => "/api/inventory-assets", expectError: "view inventory" },
  { name: "Add an inventory asset", method: "POST", path: () => "/api/inventory-assets", body: (c) => ({ catalogItemId: c.b.catalogItemId, serialNumber: "SHOULD-NOT-EXIST" }), expectError: "edit inventory" },
  { name: "Open an inventory asset", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expectError: "view inventory" },
  { name: "Edit an inventory asset", method: "PATCH", path: (c) => `/api/inventory-assets/${c.b.assetId}`, body: () => ({ notes: "Changed" }), expectError: "edit inventory" },
  { name: "Delete an inventory asset", method: "DELETE", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expectError: "delete inventory assets", clerk: true },
  { name: "Asset attachments", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expectError: "view inventory" },
  { name: "Upload an asset attachment", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expectError: "edit inventory" },
  { name: "Delete an asset attachment", method: "DELETE", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments/${c.b.assetAttachmentId}`, expectError: "edit inventory" },
  { name: "Check out an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/checkout`, body: (c) => ({ status: "INTERNAL", assignedUserId: c.b.adminId }), expectError: "edit inventory" },
  { name: "Return an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/return`, body: () => ({}), expectError: "edit inventory" },
  { name: "Redeploy an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/redeploy`, body: () => ({}), expectError: "edit inventory" },
  { name: "Offboard an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/offboard`, body: () => ({}), expectError: "edit inventory" },
  { name: "Remove an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/remove`, body: () => ({ reason: "LOST" }), expectError: "remove inventory assets", clerk: true },
  { name: "A site's containers", method: "GET", path: (c) => `/api/inventory-locations?clientLocationId=${c.b.clientLocationId}`, expectError: "view inventory" },
  { name: "Add a container", method: "POST", path: () => "/api/inventory-locations", body: (c) => ({ clientLocationId: c.b.clientLocationId, name: "Should Not Exist" }), expectError: "edit inventory" },
  { name: "Rename a container", method: "PATCH", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, body: () => ({ name: "Changed" }), expectError: "edit inventory" },
  { name: "Delete a container", method: "DELETE", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, expectError: "edit inventory" },
  { name: "Own company containers", method: "GET", path: () => "/api/inventory-locations/own-company", expectError: "view inventory" },
  { name: "List inventory stock", method: "GET", path: () => "/api/inventory-stock", expectError: "view inventory" },
  { name: "Add inventory stock", method: "POST", path: () => "/api/inventory-stock", body: (c) => ({ catalogItemId: c.fx.stockItemId, clientLocationId: c.b.clientLocationId, locationId: c.fx.containerId, quantity: 1 }), expectError: "edit inventory" },
  { name: "Adjust inventory stock", method: "PATCH", path: (c) => `/api/inventory-stock/${c.fx.stockId}/adjust`, body: () => ({ delta: 1 }), expectError: "edit inventory" },
  { name: "Delete inventory stock", method: "DELETE", path: (c) => `/api/inventory-stock/${c.fx.stockId}`, expectError: "delete inventory stock", clerk: true },
]

const refusedFor =
  (actor: Actor) =>
  (g: Guarded): Attempt => ({ ...g, actor, kind: "refused", expect: 403 })

// Picker routes other pages' forms read, open to any active user
const PICKERS: { name: string; path: string; contains: (c: AttemptContext) => string[] }[] = [
  { name: "Client picker", path: "/api/clients", contains: (c) => [c.b.clientId] },
  { name: "Client detail picker", path: "/api/clients/CLIENT", contains: (c) => [c.b.clientId, c.b.contactId] },
  { name: "Contact search", path: "/api/contacts/search?q=Sample", contains: (c) => [c.b.contactId] },
  { name: "Category picker", path: "/api/categories", contains: (c) => [c.b.categoryId] },
  { name: "Industry picker", path: "/api/industries", contains: (c) => [c.b.industryId] },
  { name: "Contact tag picker", path: "/api/contact-tags", contains: (c) => [c.b.contactTagId] },
  { name: "Custom field list", path: "/api/inventory-custom-fields", contains: (c) => [c.b.customFieldId] },
  { name: "Vendor picker", path: "/api/vendors", contains: (c) => [c.b.vendorId] },
]

const pickerFor =
  (actor: Actor) =>
  (p: (typeof PICKERS)[number]): Attempt => ({
    name: p.name,
    actor,
    kind: "allowed",
    method: "GET",
    path: (c) => p.path.replace("CLIENT", c.b.clientId),
    expect: 200,
    contains: p.contains,
  })

// The catalog picker list, with cost only for users who can see it
const catalogList = (actor: Actor, kind: Attempt["kind"], withCost: boolean): Attempt => ({
  name: withCost ? "Catalog picker list, with cost" : "Catalog picker list, without cost",
  actor,
  kind,
  method: "GET",
  path: () => "/api/catalog",
  expect: 200,
  contains: (c) => (withCost ? [c.b.catalogItemId, '"cost"'] : [c.b.catalogItemId]),
  notContains: () => (withCost ? [] : ['"cost"']),
})

// Distributor offers carry no dealer price or cost for users who can't see cost
function offersWithoutPricing(json: unknown): string | null {
  const products = (json as { products?: { offers?: Record<string, unknown>[] }[] }).products
  if (!Array.isArray(products)) return "no products list in the response"
  const priced = products.flatMap((p) => p.offers ?? []).filter((o) => "price" in o || "cost" in o)
  return priced.length > 0 ? `${priced.length} offers still include price or cost` : null
}

// Every sales order and purchase order route, and the SO/PO settings read.
// Test Everyone B, Test Rep B, and Test Clerk B hold neither order page, so
// each one is refused for all three with a 403 before any record is looked
// up. The ids are Test Admin B's records.
const ORDER_GUARDED: Guarded[] = [
  { name: "List sales orders", method: "GET", path: () => "/api/sales-orders", expectError: "view sales orders" },
  { name: "Create a sales order", method: "POST", path: () => "/api/sales-orders", body: (c) => ({ clientId: c.b.clientId }), expectError: "create sales orders" },
  { name: "Open a sales order", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expectError: "view sales orders" },
  { name: "Edit a sales order", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ internalNotes: "Changed" }), expectError: "edit sales orders" },
  { name: "Change a sales order's status", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ status: "CLOSED" }), expectError: "edit sales orders" },
  { name: "Delete a sales order", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expectError: "delete sales orders" },
  { name: "Sales order attachments", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expectError: "view sales orders" },
  { name: "Upload a sales order attachment", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expectError: "edit sales orders" },
  { name: "Delete a sales order attachment", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments/${c.b.soAttachmentId}`, expectError: "edit sales orders" },
  { name: "Sales order comments", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, expectError: "view sales orders" },
  { name: "Comment on a sales order", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, body: () => ({ message: "Should not exist" }), expectError: "view sales orders" },
  { name: "Add a sales order line item", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expectError: "edit sales orders" },
  { name: "Edit a sales order line item", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expectError: "edit sales orders" },
  { name: "Delete a sales order line item", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, expectError: "edit sales orders" },
  { name: "Sales order and purchase order settings", method: "GET", path: () => "/api/so-po-settings", expectError: "sales order and purchase order settings" },
  { name: "List purchase orders", method: "GET", path: () => "/api/purchase-orders", expectError: "view purchase orders" },
  { name: "Create a purchase order", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId }), expectError: "create purchase orders" },
  { name: "Generate a purchase order from sales order lines", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId, soLineItemIds: [c.b.soLineId] }), expectError: "create purchase orders" },
  { name: "Open a purchase order", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expectError: "view purchase orders" },
  { name: "Edit a purchase order", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expectError: "edit purchase orders" },
  { name: "Change a purchase order's status", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ status: "CANCELLED" }), expectError: "edit purchase orders" },
  { name: "Delete a purchase order", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expectError: "delete purchase orders" },
  { name: "Purchase order attachments", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments`, expectError: "view purchase orders" },
  { name: "Upload a purchase order attachment", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments`, expectError: "edit purchase orders" },
  { name: "Delete a purchase order attachment", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments/${c.b.poAttachmentId}`, expectError: "edit purchase orders" },
  { name: "Purchase order comments", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, expectError: "view purchase orders" },
  { name: "Comment on a purchase order", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, body: () => ({ message: "Should not exist" }), expectError: "view purchase orders" },
  { name: "Add a purchase order line item", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expectError: "edit purchase orders" },
  { name: "Edit a purchase order line item", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed", received: true }), expectError: "edit purchase orders" },
  { name: "Delete a purchase order line item", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, expectError: "edit purchase orders" },
  { name: "Receive a purchase order line item", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}/receive`, body: () => ({}), expectError: "edit purchase orders" },
]

// Settings, users, and roles routes Test Everyone B is refused. The
// distributor connection test is left out on purpose: a broken refusal
// there could call a real distributor.
const SETTINGS_GUARDED: Guarded[] = [
  { name: "Notification settings", method: "GET", path: () => "/api/notification-settings", expectError: "notification settings" },
  { name: "Save notification settings", method: "PATCH", path: () => "/api/notification-settings", body: () => ({ emailDefaultCc: "nobody@example.test" }), expectError: "notification settings" },
  { name: "Approval workflows", method: "GET", path: () => "/api/approval-workflows", expectError: "approval workflows" },
  { name: "Create an approval workflow", method: "POST", path: () => "/api/approval-workflows", body: (c) => ({ name: "Should Not Exist", triggerType: "TOTAL_THRESHOLD", thresholdValue: 1, requiredRoleId: c.b.globalAdminRoleId }), expectError: "create approval workflows" },
  { name: "Edit an approval workflow", method: "PATCH", path: (c) => `/api/approval-workflows/${c.b.workflowId}`, body: () => ({ name: "Changed" }), expectError: "edit approval workflows" },
  { name: "Delete an approval workflow", method: "DELETE", path: (c) => `/api/approval-workflows/${c.b.workflowId}`, expectError: "delete approval workflows" },
  { name: "Distributor settings", method: "GET", path: () => "/api/distributor-settings", expectError: "view distributor settings" },
  { name: "Change distributor settings", method: "PATCH", path: () => "/api/distributor-settings/INGRAM_MICRO", body: () => ({ enabled: true }), expectError: "change distributor settings" },
  { name: "Edit company settings", method: "PATCH", path: () => "/api/company-settings", body: () => ({ name: "Changed" }), expectError: "edit company settings" },
  { name: "Upload a company logo", method: "POST", path: () => "/api/company-settings/logo", expectError: "change the company logo" },
  { name: "Change Microsoft settings", method: "PATCH", path: () => "/api/microsoft-settings", body: () => ({ microsoftTenantId: "00000000-0000-0000-0000-000000000000" }), expectError: "configure Microsoft integration" },
  { name: "Edit quote settings", method: "PATCH", path: () => "/api/quote-settings", body: () => ({ quotePrefix: "NOPE" }), expectError: "edit quote settings" },
  { name: "Invite a user", method: "POST", path: () => "/api/users", body: () => ({ name: "Should Not Exist", email: "should-not-exist@example.test", tempPassword: "ShouldNotExist123" }), expectError: "invite users" },
  { name: "Edit a user", method: "PATCH", path: (c) => `/api/users/${c.b.adminId}`, body: () => ({ name: "Changed" }), expectError: "edit users" },
  { name: "Unlock a user", method: "POST", path: (c) => `/api/users/${c.b.adminId}/unlock`, expectError: "Only a Global Admin" },
  { name: "Create a role", method: "POST", path: () => "/api/roles", body: () => ({ name: "Should Not Exist" }), expectError: "create roles" },
  { name: "Edit a role", method: "PATCH", path: (c) => `/api/roles/${c.fx.repRoleId}`, body: () => ({ name: "Changed" }), expectError: "edit roles" },
  { name: "Delete a role", method: "DELETE", path: (c) => `/api/roles/${c.fx.repRoleId}`, expectError: "delete roles" },
  { name: "Reorder roles", method: "PUT", path: () => "/api/roles/order", body: (c) => ({ roleIds: [c.fx.repRoleId, c.fx.clerkRoleId] }), expectError: "reorder roles" },
]

// Every opportunity, attachment, stage, type, and settings route. Test
// Everyone B holds none of the opportunity keys, so each one is refused
// with a 403 before any record is looked up. The "manage opportunity
// settings" ones (stage, type, and settings writes) are also refused for
// Test Rep B and Test Opp Viewer B, who don't hold settingsSections.opportunities.
// The ids are the unassigned sample opportunity's and the company's first
// stage and type.
const OPP_SETTINGS_WRITE = "manage opportunity settings"
const OPP_GUARDED: Guarded[] = [
  { name: "List opportunities", method: "GET", path: () => "/api/opportunities", expectError: "view opportunities" },
  { name: "Create an opportunity", method: "POST", path: () => "/api/opportunities", body: (c) => ({ title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expectError: "create opportunities" },
  { name: "Open an opportunity", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expectError: "view opportunities" },
  { name: "Edit an opportunity", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: () => ({ title: "Changed" }), expectError: "edit opportunities" },
  { name: "Delete an opportunity", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expectError: "delete opportunities" },
  { name: "Opportunity attachments", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expectError: "view opportunities" },
  { name: "Opportunity related records", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expectError: "view opportunities" },
  { name: "Opportunity timeline", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expectError: "view opportunities" },
  { name: "Add an opportunity note", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expectError: "edit opportunities" },
  { name: "Edit an opportunity note", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expectError: "edit opportunities" },
  { name: "Delete an opportunity note", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, expectError: "edit opportunities" },
  { name: "Upload an opportunity attachment", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expectError: "edit opportunities" },
  { name: "Delete an opportunity attachment", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments/${c.fx.unassignedOpportunityAttachmentId}`, expectError: "edit opportunities" },
  { name: "Opportunity stages", method: "GET", path: () => "/api/opportunity-stages", expectError: "view opportunity stages" },
  { name: "Add an opportunity stage", method: "POST", path: () => "/api/opportunity-stages", body: () => ({ name: "Should Not Exist", category: "OPEN" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Edit an opportunity stage", method: "PATCH", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, body: () => ({ name: "Changed" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Delete an opportunity stage", method: "DELETE", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, expectError: OPP_SETTINGS_WRITE },
  { name: "Reorder opportunity stages", method: "POST", path: () => "/api/opportunity-stages/reorder", body: (c) => ({ stageIds: [...c.fx.opportunityStageIds].reverse() }), expectError: OPP_SETTINGS_WRITE },
  { name: "Opportunity types", method: "GET", path: () => "/api/opportunity-types", expectError: "view opportunity types" },
  { name: "Add an opportunity type", method: "POST", path: () => "/api/opportunity-types", body: () => ({ name: "Should Not Exist" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Edit an opportunity type", method: "PATCH", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, body: () => ({ name: "Changed" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Delete an opportunity type", method: "DELETE", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, expectError: OPP_SETTINGS_WRITE },
  { name: "Reorder opportunity types", method: "POST", path: () => "/api/opportunity-types/reorder", body: (c) => ({ typeIds: [...c.fx.opportunityTypeIds].reverse() }), expectError: OPP_SETTINGS_WRITE },
  { name: "Opportunity settings", method: "GET", path: () => "/api/opportunity-settings", expectError: "view opportunity settings" },
  { name: "Edit opportunity settings", method: "PATCH", path: () => "/api/opportunity-settings", body: () => ({ prefix: "NOPE" }), expectError: OPP_SETTINGS_WRITE },
]

// A created opportunity must belong to the expected owner (null for
// unassigned). It is removed again once checked.
function createdOpportunityOwnedBy(ownerId: (c: AttemptContext) => string | null) {
  return async (json: unknown, c: AttemptContext, prisma: PrismaClient): Promise<string | null> => {
    const created = json as { id?: string; owner?: { id?: string } | null }
    if (!created.id) return "no opportunity id in the response"
    try {
      const expected = ownerId(c)
      return (created.owner?.id ?? null) === expected ? null : `the owner is ${created.owner?.id ?? "nobody"}, expected ${expected ?? "nobody"}`
    } finally {
      await prisma.opportunity.deleteMany({ where: { id: created.id } })
    }
  }
}

// Reads any active user may make, and what they must leave out
const activeReadsFor = (actor: Actor): Attempt[] => [
  { name: "Company settings (any signed in user)", actor, kind: "allowed", method: "GET", path: () => "/api/company-settings", expect: 200, contains: () => ["primaryColor"] },
  { name: "Microsoft settings, no secret", actor, kind: "allowed", method: "GET", path: () => "/api/microsoft-settings", expect: 200, contains: () => ["hasClientSecret"], notContains: () => ["microsoftClientSecret"] },
  { name: "Users list, no email addresses", actor, kind: "allowed", method: "GET", path: () => "/api/users", expect: 200, contains: (c) => [c.names.adminName], notContains: (c) => [c.names.adminEmail, '"email"'] },
  { name: "Roles list, no permissions", actor, kind: "allowed", method: "GET", path: () => "/api/roles", expect: 200, contains: (c) => [c.b.globalAdminRoleId], notContains: () => ['"permissions"'] },
  { name: "Enabled distributors", actor, kind: "allowed", method: "GET", path: () => "/api/distributors/enabled", expect: 200, contains: () => ["["] },
  { name: "Own distributor preferences", actor, kind: "allowed", method: "GET", path: () => "/api/distributor-search/preferences", expect: 200, contains: () => ["distributors"] },
  { name: "Save own distributor preferences", actor, kind: "allowed", method: "PATCH", path: () => "/api/distributor-search/preferences", body: () => ({ distributors: [] }), expect: 200, contains: () => ["distributors"] },
  { name: "Own notifications", actor, kind: "allowed", method: "GET", path: () => "/api/notifications", expect: 200, contains: () => ["unreadCount"] },
  { name: "Own dashboards", actor, kind: "allowed", method: "GET", path: () => "/api/dashboards", expect: 200, contains: () => ["isMyDefault"] },
]

// A widget the user may not see answers with no data, never an error
const noAccessWidget = (actor: Actor, type: string): Attempt => ({
  name: `${type} widget, no data`,
  actor,
  kind: "allowed",
  method: "GET",
  path: () => `/api/dashboards/widget-data?type=${type}`,
  expect: 200,
  contains: () => ['"noAccess":true'],
  notContains: () => ['"count"', '"groups"'],
})

// The created template line must hold the catalog item's stored cost, not
// the bogus one sent. The line is removed again once checked.
async function templateLineUsesCatalogCost(json: unknown, prisma: PrismaClient): Promise<string | null> {
  const created = json as { id?: string; cost?: unknown }
  if (!created.id) return "no line item id in the response"
  try {
    if ("cost" in created) return "the response includes cost for a user who can't see it"
    const row = await prisma.quoteTemplateLineItem.findUnique({ where: { id: created.id }, select: { cost: true } })
    if (!row) return "the created line item isn't in the database"
    return row.cost === SAMPLE_ITEM_COST ? null : `stored cost is ${row.cost}, the catalog cost is ${SAMPLE_ITEM_COST}`
  } finally {
    await prisma.quoteTemplateLineItem.deleteMany({ where: { id: created.id } })
  }
}

// The open purchase orders widget counts only the user's own
async function openPOsCountOwn(json: unknown, companyId: string, userId: string, prisma: PrismaClient) {
  const count = (json as { count?: number }).count
  const own = await prisma.purchaseOrder.count({
    where: { companyId, userId, status: { in: ["DRAFT", "PARTS_ORDERED", "ON_HOLD", "BACKORDERED"] } },
  })
  return count === own ? null : `count is ${count}, the user has ${own} open purchase orders`
}

const ATTEMPTS: Attempt[] = [
  // ── Positive controls: Global Admin B ──
  { name: "List quotes shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/quotes", expect: 200, contains: (c) => [c.b.quoteId, c.fx.repQuoteId] },
  { name: "Open own quote, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 200, contains: (c) => [c.b.quoteId, '"cost"'] },
  { name: "Open the Rep's quote", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 200, contains: (c) => [c.fx.repQuoteId] },
  { name: "Edit own quote", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: (c) => ({ title: c.names.quote }), expect: 200, contains: (c) => [c.b.quoteId] },
  { name: "Edit own quote line item", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: (c) => ({ name: c.names.quoteLine }), expect: 200, contains: (c) => [c.b.quoteLineId] },
  { name: "Quote approvals", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 200, contains: () => ["["] },
  { name: "Quote comments", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Quote versions", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 200, contains: (c) => [c.b.quoteId] },
  { name: "Quote scorecard", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-scorecard", expect: 200, contains: () => ["totalQuotes"] },
  { name: "Quote settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  { name: "Quote templates", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Open a quote template", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Edit a quote template", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: (c) => ({ name: c.names.template }), expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Distributor search", actor: "admin", kind: "control", method: "GET", path: () => "/api/distributor-search?q=test", expect: 200, contains: () => ["products"] },
  { name: "Open quotes widget", actor: "admin", kind: "control", method: "GET", path: () => "/api/dashboards/widget-data?type=OPEN_QUOTES", expect: 200, contains: () => ["count"] },
  { name: "Mailbox list shows every mailbox, no tokens", actor: "admin", kind: "control", method: "GET", path: () => "/api/microsoft-connections", expect: 200, contains: (c) => [c.fx.adminMailboxId, c.senderMailboxId], notContains: NO_TOKENS },
  {
    name: "Send options: may choose, owner's mailbox by default",
    actor: "admin",
    kind: "control",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      const ids = o.options.map((x) => x.connectionId)
      if (!o.canChooseSender) return "canChooseSender should be true"
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the quote owner's mailbox"
      if (!ids.includes(c.fx.adminMailboxId) || !ids.includes(c.senderMailboxId)) return "options should list every company mailbox"
      if (ids.includes(c.fxC.adminMailboxId)) return "options include another company's mailbox"
      return null
    },
  },
  catalogList("admin", "control", true),
  { name: "Catalog order history shows everyone's sales orders", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`, expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.clerkSalesOrderId] },
  { name: "Vendor purchase orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`, expect: 200, contains: (c) => [c.b.purchaseOrderId, c.fx.clerkPurchaseOrderId] },
  { name: "Users list, with email addresses", actor: "admin", kind: "control", method: "GET", path: () => "/api/users", expect: 200, contains: (c) => [c.names.adminEmail] },
  { name: "Roles list, with permissions", actor: "admin", kind: "control", method: "GET", path: () => "/api/roles", expect: 200, contains: () => ['"permissions"'] },
  { name: "List sales orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.ordersSalesOrderId] },
  { name: "Open a sales order, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId, '"cost"'] },
  { name: "List purchase orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/purchase-orders", expect: 200, contains: (c) => [c.b.purchaseOrderId, c.fx.ordersPurchaseOrderId] },
  { name: "Open a purchase order, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId, '"unitCost"'] },
  { name: "SO and PO settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/so-po-settings", expect: 200, contains: () => ["soPrefix"] },
  { name: "Notification settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/notification-settings", expect: 200, contains: () => ["emailSignature"] },
  { name: "Approval workflows", actor: "admin", kind: "control", method: "GET", path: () => "/api/approval-workflows", expect: 200, contains: (c) => [c.b.workflowId] },
  { name: "Open purchase orders widget", actor: "admin", kind: "control", method: "GET", path: () => "/api/dashboards/widget-data?type=OPEN_POS", expect: 200, contains: () => ['"count"'] },

  // ── Positive controls: Test Orders B (both order pages, create and edit
  // on both, no viewAll, no generatePO). Edits send the stored values. ──
  { name: "List sales orders shows only own", actor: "orders", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.fx.ordersSalesOrderId], notContains: (c) => [c.b.salesOrderId, c.fx.clerkSalesOrderId] },
  { name: "Open own sales order, with cost", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId, '"cost"'] },
  { name: "Edit own sales order (same notes)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: (c) => ({ internalNotes: c.names.ordersSalesOrder }), expect: 200, contains: (c) => [c.fx.ordersSalesOrderId] },
  { name: "Edit own sales order line item (same name)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.fx.ordersSoLineId}`, body: (c) => ({ name: c.names.ordersSoLine }), expect: 200, contains: (c) => [c.fx.ordersSoLineId] },
  { name: "Own sales order comments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Own sales order attachments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/attachments`, expect: 200, contains: () => ["["] },
  { name: "Create a sales order (no client, past the permission check)", actor: "orders", kind: "control", method: "POST", path: () => "/api/sales-orders", body: () => ({}), expect: 400, contains: () => ["A client is required"] },
  { name: "List purchase orders shows only own", actor: "orders", kind: "control", method: "GET", path: () => "/api/purchase-orders", expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId], notContains: (c) => [c.b.purchaseOrderId, c.b.purchaseOrder2Id, c.fx.clerkPurchaseOrderId] },
  { name: "Open own purchase order, with cost", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId, '"unitCost"'] },
  { name: "Edit own purchase order (same notes)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: (c) => ({ internalNotes: c.names.ordersPurchaseOrder }), expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId] },
  { name: "Edit own purchase order line item (same name)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.fx.ordersPoLineId}`, body: (c) => ({ name: c.names.ordersPoLine }), expect: 200, contains: (c) => [c.fx.ordersPoLineId] },
  { name: "Own purchase order comments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/comments`, expect: 200, contains: () => ["["] },
  // A manual purchase order, sent without a vendor: the 400 comes after the
  // purchaseOrders.create check, which shows it passed
  { name: "Create a manual purchase order (no vendor, past the permission check)", actor: "orders", kind: "control", method: "POST", path: () => "/api/purchase-orders", body: () => ({}), expect: 400, contains: () => ["A vendor is required"] },
  {
    name: "Open purchase orders widget counts only own",
    actor: "orders",
    kind: "control",
    method: "GET",
    path: () => "/api/dashboards/widget-data?type=OPEN_POS",
    expect: 200,
    check: (json, c, prisma) => openPOsCountOwn(json, c.b.companyId, c.fx.ordersUserId, prisma),
  },

  // ── Positive controls: Test Viewer B (both order pages and viewAll, no
  // edit, so no cost) and Test Templater B (Quote Settings only) ──
  { name: "List sales orders shows everyone's", actor: "viewer", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.ordersSalesOrderId] },
  { name: "Open someone else's sales order, without cost", actor: "viewer", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId], notContains: () => ['"cost"', '"unitCost"'] },
  { name: "Open someone else's purchase order, without cost", actor: "viewer", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId], notContains: () => ['"unitCost"'] },
  { name: "Edit the cost template (same name)", actor: "templater", kind: "control", method: "PATCH", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}`, body: (c) => ({ name: c.names.costTemplate }), expect: 200, contains: (c) => [c.fx.costTemplateId] },

  // ── Positive controls: Test Rep B (pages.quotes, quotes.create, quotes.edit) ──
  { name: "List quotes shows only own", actor: "rep", kind: "control", method: "GET", path: () => "/api/quotes", expect: 200, contains: (c) => [c.fx.repQuoteId], notContains: (c) => [c.b.quoteId] },
  { name: "Open own quote, with cost", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 200, contains: (c) => [c.fx.repQuoteId, '"cost"'] },
  { name: "Edit own quote", actor: "rep", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, body: (c) => ({ title: c.names.repQuote }), expect: 200, contains: (c) => [c.fx.repQuoteId] },
  { name: "Edit own quote line item", actor: "rep", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.fx.repQuoteLineId}`, body: (c) => ({ name: c.names.repQuoteLine }), expect: 200, contains: (c) => [c.fx.repQuoteLineId] },
  { name: "Own quote comments", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Own quote versions", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/versions`, expect: 200, contains: (c) => [c.fx.repQuoteId], notContains: (c) => [c.b.quoteId] },
  { name: "Own quote approvals", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals`, expect: 200, contains: () => ["["] },
  { name: "Template picker", actor: "rep", kind: "control", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Open a quote template", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Distributor search picker", actor: "rep", kind: "control", method: "GET", path: () => "/api/distributor-search?q=test", expect: 200, contains: () => ["products"] },
  { name: "Quote settings", actor: "rep", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  {
    name: "Scorecard counts only own quotes",
    actor: "rep",
    kind: "control",
    method: "GET",
    path: () => "/api/quote-scorecard",
    expect: 200,
    check: async (json, c, prisma) => {
      const total = (json as { totalQuotes?: number }).totalQuotes
      const [own, all] = await Promise.all([
        prisma.quote.count({ where: { companyId: c.b.companyId, userId: c.repUserId, isActive: true } }),
        prisma.quote.count({ where: { companyId: c.b.companyId, isActive: true } }),
      ])
      if (own === all) return "test data problem: the Rep owns every active quote, so the scoping can't be seen"
      return total === own ? null : `totalQuotes is ${total}, the Rep owns ${own} active quotes`
    },
  },
  {
    name: "Open quotes widget counts only own quotes",
    actor: "rep",
    kind: "control",
    method: "GET",
    path: () => "/api/dashboards/widget-data?type=OPEN_QUOTES",
    expect: 200,
    check: async (json, c, prisma) => {
      const count = (json as { count?: number }).count
      const own = await prisma.quote.count({
        where: { companyId: c.b.companyId, userId: c.repUserId, status: { in: ["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED"] } },
      })
      return count === own ? null : `count is ${count}, the Rep has ${own} open quotes`
    },
  },

  // ── Positive controls: Test Sender B and Test Everyone B ──
  {
    name: "Send options: own mailbox only, can't choose",
    actor: "sender",
    kind: "control",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: (c) => [...NO_TOKENS(), c.fx.adminMailboxId, c.names.adminMailboxEmail],
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.canChooseSender) return "canChooseSender should be false"
      if (o.defaultConnectionId !== c.senderMailboxId) return "default should be the sender's own mailbox, not the quote owner's"
      if (o.options.length !== 1 || o.options[0].connectionId !== c.senderMailboxId) return "options should hold only the default"
      return null
    },
  },
  { name: "Mailbox list shows only own", actor: "sender", kind: "control", method: "GET", path: () => "/api/microsoft-connections", expect: 200, contains: (c) => [c.senderMailboxId], notContains: (c) => [...NO_TOKENS(), c.fx.adminMailboxId] },
  { name: "Quote settings (any signed in user)", actor: "everyone", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  {
    name: "Mailbox list is empty (owns none)",
    actor: "everyone",
    kind: "control",
    method: "GET",
    path: () => "/api/microsoft-connections",
    expect: 200,
    check: (json) => (Array.isArray(json) && json.length === 0 ? null : "expected an empty list"),
  },

  // ── Positive controls: Test Clerk B (Clients, Vendors, Catalog, and
  // Inventory pages, clients.create, clients.edit) ──
  // Edits send the sample record's current values, so nothing really
  // changes. A create that would add a record is sent incomplete instead:
  // the 400 it gets comes after the permission check, which shows it passed.
  { name: "Open a client", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/clients/${c.b.clientId}`, expect: 200, contains: (c) => [c.b.clientId] },
  {
    name: "Edit a client (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}`,
    body: (c) => ({ name: c.names.client, industryId: c.b.industryId, mainBillingLocationId: c.b.clientLocationId, mainShippingLocationId: c.b.clientLocationId }),
    expect: 200,
    contains: (c) => [c.b.clientId],
  },
  {
    name: "Edit a client contact (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}/contacts/${c.b.contactId}`,
    body: (c) => ({ firstName: c.names.contactFirstName, lastName: c.names.contactLastName, email: c.names.contactEmail, locationId: c.b.clientLocationId, isPrimary: true }),
    expect: 200,
    contains: (c) => [c.b.contactId],
  },
  {
    name: "Edit a client location (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}/locations/${c.b.clientLocationId}`,
    body: (c) => ({
      name: c.names.clientLocation,
      address: c.names.clientLocationAddress,
      city: c.names.clientLocationCity,
      isPrimary: true,
      billingContactId: c.b.contactId,
      shippingContactId: c.b.contactId,
    }),
    expect: 200,
    contains: (c) => [c.b.clientLocationId],
  },
  { name: "Import clients (empty, past the permission check)", actor: "clerk", kind: "control", method: "POST", path: () => "/api/clients/import", body: () => ({ rows: [] }), expect: 400, contains: () => ["No rows to import"] },
  // Allowed by clients.create or clients.edit, for the client forms. The
  // existing name comes back as is, so nothing is added.
  { name: "Add an existing industry inline", actor: "clerk", kind: "control", method: "POST", path: () => "/api/industries", body: (c) => ({ name: c.names.industry }), expect: 200, contains: (c) => [c.b.industryId] },
  { name: "Client assets", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/assets`, expect: 200, contains: () => ["["] },
  catalogList("clerk", "control", true),
  { name: "Open a catalog item", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expect: 200, contains: (c) => [c.b.catalogItemId, '"cost"'] },
  { name: "Catalog change log", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/change-log`, expect: 200, contains: () => ["["] },
  {
    name: "Catalog order history shows only own sales orders",
    actor: "clerk",
    kind: "control",
    method: "GET",
    path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`,
    expect: 200,
    contains: (c) => [c.fx.clerkSalesOrderId],
    notContains: (c) => [c.b.salesOrderId],
  },
  { name: "Create a catalog item (no category, past the permission check)", actor: "clerk", kind: "control", method: "POST", path: () => "/api/catalog", body: () => ({ name: "Should Not Exist" }), expect: 400, contains: () => ["Category is required"] },
  { name: "Open a vendor", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}`, expect: 200, contains: (c) => [c.b.vendorId] },
  { name: "Edit a vendor (same name)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}`, body: (c) => ({ name: c.names.vendor }), expect: 200, contains: (c) => [c.b.vendorId] },
  { name: "Vendor attachments", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expect: 200, contains: (c) => [c.b.vendorAttachmentId] },
  {
    name: "Vendor purchase orders shows only own",
    actor: "clerk",
    kind: "control",
    method: "GET",
    path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`,
    expect: 200,
    contains: (c) => [c.fx.clerkPurchaseOrderId],
    notContains: (c) => [c.b.purchaseOrderId, c.b.purchaseOrder2Id],
  },
  { name: "List inventory assets", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-assets", expect: 200, contains: (c) => [c.b.assetId] },
  { name: "Open an inventory asset", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expect: 200, contains: (c) => [c.b.assetId] },
  { name: "Asset attachments", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expect: 200, contains: (c) => [c.b.assetAttachmentId] },
  { name: "A site's containers", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-locations?clientLocationId=${c.b.clientLocationId}`, expect: 200, contains: (c) => [c.fx.containerId] },
  { name: "Rename a container (same name)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, body: (c) => ({ name: c.names.container }), expect: 200, contains: (c) => [c.fx.containerId] },
  { name: "Own company containers", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-locations/own-company", expect: 200, contains: () => ["["] },
  { name: "List inventory stock", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-stock", expect: 200, contains: (c) => [c.fx.stockId] },
  { name: "Adjust inventory stock by zero (past the permission check)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/inventory-stock/${c.fx.stockId}/adjust`, body: () => ({ delta: 0 }), expect: 400, contains: () => ["non-zero"] },

  // ── Positive controls: opportunities ──
  // Global Admin B sees all three sample opportunities; Test Rep B (no see
  // all) its own and the unassigned one; Test Opp Viewer B (no see all,
  // owns none) only the unassigned one; Test Opp Settings B manages
  // stages, types, and settings. Its writes save the values already stored.
  { name: "List opportunities shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.b.opportunityId, c.fx.repOpportunityId, c.fx.unassignedOpportunityId] },
  { name: "Open the Rep's opportunity", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 200, contains: (c) => [c.fx.repOpportunityId] },
  { name: "List opportunities: own and unassigned only", actor: "rep", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.repOpportunityId, c.fx.unassignedOpportunityId], notContains: (c) => [c.b.opportunityId] },
  { name: "Open own opportunity", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 200, contains: (c) => [c.fx.repOpportunityId] },
  { name: "Own opportunity attachments", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/attachments`, expect: 200, contains: (c) => [c.fx.repOpportunityAttachmentId] },
  { name: "List opportunities: unassigned only", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: (c) => [c.b.opportunityId, c.fx.repOpportunityId] },
  { name: "Open the unassigned opportunity", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 200, contains: (c) => [c.fx.unassignedOpportunityId] },
  { name: "Unassigned opportunity attachments", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expect: 200, contains: (c) => [c.fx.unassignedOpportunityAttachmentId] },
  { name: "Opportunity stages", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-stages", expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Opportunity types", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-types", expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Opportunity settings", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-settings", expect: 200, contains: () => ['"prefix"'] },
  { name: "Opportunity stages", actor: "oppSettings", kind: "control", method: "GET", path: () => "/api/opportunity-stages", expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Opportunity settings", actor: "oppSettings", kind: "control", method: "GET", path: () => "/api/opportunity-settings", expect: 200, contains: () => ['"prefix"'] },
  { name: "Save opportunity settings unchanged", actor: "oppSettings", kind: "control", method: "PATCH", path: () => "/api/opportunity-settings", body: () => ({ prefix: "OPP" }), expect: 200, contains: () => ['"prefix":"OPP"'] },
  { name: "Rename a stage to its own name", actor: "oppSettings", kind: "control", method: "PATCH", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, body: () => ({ name: "New" }), expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Rename a type to its own name", actor: "oppSettings", kind: "control", method: "PATCH", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, body: () => ({ name: "New Business" }), expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Reorder stages in their current order", actor: "oppSettings", kind: "control", method: "POST", path: () => "/api/opportunity-stages/reorder", body: (c) => ({ stageIds: c.fx.opportunityStageIds }), expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Reorder types in their current order", actor: "oppSettings", kind: "control", method: "POST", path: () => "/api/opportunity-types/reorder", body: (c) => ({ typeIds: c.fx.opportunityTypeIds }), expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Own opportunity related records", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/related`, expect: 200, contains: () => ['"quotes"', '"salesOrders"', '"purchaseOrders"'] },
  // Client details come with an opportunity the user may open, and never with the list
  { name: "Unassigned opportunity with client details", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 200, contains: (c) => [c.b.clientId, '"mainBillingLocation"', '"locations"', '"title"', '"email"'] },
  { name: "List opportunities without client details", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: () => ['"mainBillingLocation"', '"locations"'] },
  { name: "Unassigned opportunity timeline", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expect: 200, contains: (c) => [c.fx.unassignedRepNoteId, c.fx.unassignedAdminNoteId, c.fx.unassignedActionId] },
  { name: "Unassigned opportunity related records", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expect: 200, contains: () => ['"quotes"'] },

  // ── Test Everyone B: no permissions, refused everywhere ──
  { name: "List quotes", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quotes", expect: 403, expectError: "permission" },
  { name: "Create a quote", actor: "everyone", kind: "refused", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.b.clientId }), expect: 403, expectError: "permission" },
  { name: "Open admin's quote", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 404, expectError: "Not found" },
  { name: "Open Rep's quote", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 404, expectError: "Not found" },
  { name: "Edit a quote", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit quotes" },
  { name: "Delete a quote", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 403, expectError: "delete quotes" },
  { name: "Quote approvals", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 404, expectError: "Not found" },
  { name: "Approve", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/approvals/${c.fakeId}/approve`, expect: 403, expectError: "approve quotes" },
  { name: "Reject", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/approvals/${c.fakeId}/reject`, body: () => ({ reason: "x" }), expect: 403, expectError: "reject quotes" },
  { name: "Assign", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/assign`, body: (c) => ({ userId: c.fx.everyoneUserId }), expect: 403, expectError: "edit quotes" },
  { name: "Read comments", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Post a comment", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "Mark comments viewed", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/mark-comments-viewed`, expect: 404, expectError: "Not found" },
  { name: "Download PDF", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/pdf`, expect: 404, expectError: "Not found" },
  { name: "Copy", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/copy`, expect: 403, expectError: "create quotes" },
  { name: "Flag", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/flag`, expect: 403, expectError: "edit quotes" },
  { name: "Reactivate", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/reactivate`, expect: 403, expectError: "edit quotes" },
  { name: "Add a section", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Remove a section", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Add a line item", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Edit a line item", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "edit quotes" },
  { name: "Delete a line item", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, expect: 403, expectError: "edit quotes" },
  { name: "Mark as sent", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send`, expect: 403, expectError: "status" },
  { name: "Change status", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/status`, body: () => ({ status: "DRAFT" }), expect: 403, expectError: "status" },
  { name: "List versions", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "New version", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 403, expectError: "create quotes" },
  { name: "Send by email", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody(), expect: 403, expectError: "send quotes" },
  { name: "Send options", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/send-options`, expect: 403, expectError: "send quotes" },
  { name: "Quote scorecard", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quote-scorecard", expect: 403, expectError: "permission" },
  { name: "List templates", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quote-templates", expect: 403, expectError: "permission" },
  { name: "Open a template", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 403, expectError: "permission" },
  { name: "Create a template", actor: "everyone", kind: "refused", method: "POST", path: () => "/api/quote-templates", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template line item", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template line item", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items/${c.fakeId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Delete a template line item", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items/${c.fakeId}`, expect: 403, expectError: "quote templates" },
  { name: "Add a template section", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Remove a template section", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Distributor search", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/distributor-search?q=test", expect: 403, expectError: "search distributors" },
  // A widget the user may not see answers with no data rather than a 403,
  // so a shared dashboard shows a no access note instead of an error
  noAccessWidget("everyone", "OPEN_QUOTES"),
  { name: "Disconnect the admin's mailbox", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },
  // Any signed in user may start connecting their own mailbox. The test
  // company has no Microsoft credentials, so the route stops there, which
  // shows it got past the access check without reaching Microsoft.
  { name: "Start connecting own mailbox", actor: "everyone", kind: "allowed", method: "GET", path: () => "/api/microsoft/connect?label=Dev%20check", expect: 307, location: "missing_credentials" },
  { name: "Mailbox callback without a code", actor: "everyone", kind: "allowed", method: "GET", path: () => "/api/microsoft/callback", expect: 307, location: "invalid_state" },

  // ── Test Rep B: refused what it lacks, and other people's quotes ──
  { name: "Open admin's quote", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 404, expectError: "Not found" },
  { name: "Edit admin's quote", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: () => ({ title: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete own quote", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 403, expectError: "delete quotes" },
  { name: "Edit admin's line item", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Edit admin's line item under own quote", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete admin's line item under own quote", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.b.quoteLineId}`, expect: 404, expectError: "Not found" },
  { name: "Add a line item to admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Read admin's comments", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Comment on admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "Mark admin's comments viewed", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/mark-comments-viewed`, expect: 404, expectError: "Not found" },
  { name: "Download admin's PDF", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/pdf`, expect: 404, expectError: "Not found" },
  { name: "Admin's quote approvals", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 404, expectError: "Not found" },
  { name: "Admin's quote versions", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "Copy admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.b.contactId }), expect: 404, expectError: "Not found" },
  { name: "Copy own quote without a client or contact", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/copy`, expect: 400, expectError: "A client is required" },
  { name: "New version of admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "Flag admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/flag`, expect: 404, expectError: "Not found" },
  { name: "Reactivate admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/reactivate`, expect: 404, expectError: "Not found" },
  { name: "Add a section to admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Assign admin's quote to self", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/assign`, body: (c) => ({ userId: c.repUserId }), expect: 404, expectError: "Not found" },
  // Without quotes.viewAllUsersQuotes a quote can only be assigned to
  // yourself, so another company's user gets the same refusal as a
  // colleague (the admin's attempt below still checks "Invalid user")
  { name: "Assign own quote to another company's user", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.c.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Assign own quote to another rep", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.b.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Create a quote assigned to another rep", actor: "rep", kind: "refused", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.b.clientId, contactId: c.b.contactId, userId: c.b.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Assign own quote to self", actor: "rep", kind: "allowed", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.repUserId }), expect: 200, notContains: () => ['"accessToken"'] },
  { name: "Assign the rep's quote to another company's user", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.c.adminId }), expect: 400, expectError: "Invalid user" },
  { name: "Approve", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals/${c.fakeId}/approve`, expect: 403, expectError: "approve quotes" },
  { name: "Reject", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals/${c.fakeId}/reject`, body: () => ({ reason: "x" }), expect: 403, expectError: "reject quotes" },
  { name: "Mark own quote as sent", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send`, expect: 403, expectError: "status" },
  { name: "Change own quote status", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/status`, body: () => ({ status: "DECLINED" }), expect: 403, expectError: "status" },
  { name: "Send own quote by email", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-email`, body: () => sendBody(), expect: 403, expectError: "send quotes" },
  { name: "Send own quote as the admin's mailbox", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fx.adminMailboxId }), expect: 403, expectError: "send quotes" },
  { name: "Send options", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-options`, expect: 403, expectError: "send quotes" },
  { name: "Create a template", actor: "rep", kind: "refused", method: "POST", path: () => "/api/quote-templates", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template line item", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template section", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Remove a template section", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Disconnect the admin's mailbox", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },

  // ── Test Sender B: may send, but only from its own mailbox ──
  { name: "Send as the admin's mailbox", actor: "sender", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fx.adminMailboxId }), expect: 403, expectError: "send as another mailbox" },

  // ── Global Admin B: refused before any mail would go out ──
  { name: "Send as another company's mailbox", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fxC.adminMailboxId }), expect: 400, expectError: "Invalid mailbox" },
  { name: "Send to an invalid address", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ to: "not-an-address" }), expect: 400, expectError: "not a valid email address" },
  { name: "Send to too many recipients", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ to: Array.from({ length: 26 }, (_, i) => `nobody${i}@example.test`).join(", ") }), expect: 400, expectError: "at most" },
  { name: "Send with no message", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ message: "" }), expect: 400, expectError: "required" },

  // ── Sales orders, purchase orders, settings, users, and roles ──
  // Test Everyone B: refused every guarded route, allowed the reads any
  // active user may make, and no data from widgets it may not see
  ...ORDER_GUARDED.map(refusedFor("everyone")),
  ...SETTINGS_GUARDED.map(refusedFor("everyone")),
  ...activeReadsFor("everyone"),
  noAccessWidget("everyone", "OPEN_POS"),
  noAccessWidget("everyone", "INVENTORY_BY_STATUS"),
  noAccessWidget("everyone", "INVENTORY_BY_CLIENT"),
  noAccessWidget("everyone", "TOTAL_CLIENTS"),
  // Test Rep B and Test Clerk B hold neither order page
  ...ORDER_GUARDED.map(refusedFor("rep")),
  ...ORDER_GUARDED.map(refusedFor("clerk")),

  // Test Orders B: only its own orders, and nothing it holds no key for
  { name: "Open the admin's sales order", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expect: 404, expectError: "Not found" },
  { name: "Edit the admin's sales order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Add a line item to the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's sales order line item", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's line item under own sales order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete the admin's sales order line item", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, expect: 404, expectError: "Not found" },
  { name: "Read the admin's sales order comments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Comment on the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "The admin's sales order attachments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expect: 404, expectError: "Not found" },
  { name: "Delete the admin's sales order attachment", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments/${c.b.soAttachmentId}`, expect: 404, expectError: "Not found" },
  { name: "Delete own sales order", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 403, expectError: "delete sales orders" },
  { name: "Change own sales order's status", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: () => ({ status: "CLOSED" }), expect: 403, expectError: "change a sales order's status" },
  { name: "Generate a purchase order from own sales order lines", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.fx.ordersSalesOrderId, soLineItemIds: [c.fx.ordersSoLineId] }), expect: 403, expectError: "generate purchase orders" },
  { name: "Generate a purchase order from the admin's sales order lines", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId, soLineItemIds: [c.b.soLineId] }), expect: 403, expectError: "generate purchase orders" },
  { name: "Open the admin's purchase order", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expect: 404, expectError: "Not found" },
  { name: "Edit the admin's purchase order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Add a line item to the admin's purchase order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's purchase order line item", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed", received: true }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's line item under own purchase order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Receive the admin's purchase order line item", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}/receive`, body: () => ({}), expect: 404, expectError: "Not found" },
  { name: "Read the admin's purchase order comments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Delete the admin's purchase order attachment", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments/${c.b.poAttachmentId}`, expect: 404, expectError: "Not found" },
  { name: "Delete own purchase order", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 403, expectError: "delete purchase orders" },
  { name: "Change own purchase order's status", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: () => ({ status: "CANCELLED" }), expect: 403, expectError: "change a purchase order's status" },
  { name: "SO and PO settings", actor: "orders", kind: "refused", method: "GET", path: () => "/api/so-po-settings", expect: 403, expectError: "sales order and purchase order settings" },
  ...activeReadsFor("orders"),

  // Test Viewer B: sees every order, edits none
  { name: "Edit someone else's sales order", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 403, expectError: "edit sales orders" },
  { name: "Edit a sales order line item", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.fx.ordersSoLineId}`, body: () => ({ cost: 1 }), expect: 403, expectError: "edit sales orders" },
  { name: "Edit someone else's purchase order", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 403, expectError: "edit purchase orders" },
  { name: "Generate a purchase order", actor: "viewer", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.fx.ordersSalesOrderId, soLineItemIds: [c.fx.ordersSoLineId] }), expect: 403, expectError: "create purchase orders" },

  // Cost on line item routes: a user who can't see cost can't set it
  {
    name: "Add a template line with a bogus cost: stored cost is the catalog cost",
    actor: "templater",
    kind: "allowed",
    method: "POST",
    path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items`,
    body: (c) => ({ name: "Dev check cost line", catalogItemId: c.b.catalogItemId, unitPrice: 100, cost: 9999 }),
    expect: 200,
    check: (json, _c, prisma) => templateLineUsesCatalogCost(json, prisma),
  },
  {
    name: "Edit a template line's cost: stored cost is unchanged",
    actor: "templater",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items/${c.fx.costTemplateLineId}`,
    body: (c) => ({ name: c.names.costTemplateLine, cost: 1 }),
    expect: 200,
    notContains: () => ['"cost"'],
    check: async (_json, c, prisma) => {
      const row = await prisma.quoteTemplateLineItem.findUnique({ where: { id: c.fx.costTemplateLineId }, select: { cost: true } })
      return row?.cost === SAMPLE_ITEM_COST ? null : `stored cost is ${row?.cost}, expected it to stay ${SAMPLE_ITEM_COST}`
    },
  },
  {
    name: "Edit a catalog item without a cost field: cost and category unchanged",
    actor: "clerk",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/catalog/${c.b.catalogItemId}`,
    body: (c) => ({ name: c.names.catalogItem }),
    expect: 200,
    check: async (_json, c, prisma) => {
      const row = await prisma.catalogItem.findUnique({ where: { id: c.b.catalogItemId }, select: { cost: true, categoryId: true } })
      if (row?.cost !== SAMPLE_ITEM_COST) return `cost is ${row?.cost}, expected it to stay ${SAMPLE_ITEM_COST}`
      return row.categoryId === c.b.categoryId ? null : "the category changed"
    },
  },
  { name: "SO and PO settings", actor: "templater", kind: "refused", method: "GET", path: () => "/api/so-po-settings", expect: 403, expectError: "sales order and purchase order settings" },
  { name: "Open a sales order", actor: "templater", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expect: 403, expectError: "view sales orders" },
  // Quote Settings users read the templates they maintain
  { name: "List quote templates", actor: "templater", kind: "allowed", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId, c.fx.costTemplateId] },
  { name: "Open a quote template", actor: "templater", kind: "allowed", method: "GET", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}`, expect: 200, contains: (c) => [c.fx.costTemplateId], notContains: () => ['"cost"'] },

  // ── Purchase order received flag: an inventory tracked line (the sample
  // catalog item is Physical) is only received through Receive ──
  { name: "Mark own tracked purchase order line received", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.fx.ordersPoLineId}`, body: () => ({ received: true }), expect: 400, expectError: "Use Receive to add this item to inventory" },
  { name: "Mark a tracked purchase order line received", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ received: true }), expect: 400, expectError: "Use Receive to add this item to inventory" },
  {
    name: "Mark own untracked purchase order line received (then put back)",
    actor: "orders",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.untrackedPoLineId}`,
    body: () => ({ received: true }),
    expect: 200,
    check: async (_json, c, prisma) => {
      const row = await prisma.pOLineItem.findUnique({ where: { id: c.untrackedPoLineId }, select: { received: true } })
      await prisma.pOLineItem.update({ where: { id: c.untrackedPoLineId }, data: { received: false } })
      return row?.received === true ? null : "the line is not marked received"
    },
  },

  // ── A manual purchase order may only name a sales order its creator can open ──
  { name: "Manual purchase order naming the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId }), expect: 400, expectError: "Invalid sales order" },
  { name: "Manual purchase order naming another company's sales order", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.c.salesOrderId }), expect: 400, expectError: "Invalid sales order" },

  // ── Invites: another company's email gets the generic answer, and a
  // non Global Admin can't invite at or above their own rank ──
  { name: "Invite another company's user email", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.namesC.adminEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },
  { name: "Invite an email that isn't an email", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: () => ({ name: "Should Not Exist", email: "not-an-email", tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },
  { name: "Invite an email already used in this company", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.names.repEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "A user with that email already exists" },
  { name: "Invite into own role (same rank)", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: "should-not-exist-manager@example.test", tempPassword: "ShouldNotExist123", roleIds: [c.managerRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Invite into Global Admin", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: "should-not-exist-manager@example.test", tempPassword: "ShouldNotExist123", roleIds: [c.b.globalAdminRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Invite another company's user email", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.namesC.adminEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },

  // ── Clients, catalog, vendors, company settings lists, and inventory ──
  // Test Everyone B and Test Rep B: refused every guarded route, allowed the open pickers
  ...GUARDED.map(refusedFor("everyone")),
  ...PICKERS.map(pickerFor("everyone")),
  catalogList("everyone", "allowed", false),
  ...GUARDED.map(refusedFor("rep")),
  ...PICKERS.map(pickerFor("rep")),
  // quotes.edit is enough to see cost
  catalogList("rep", "allowed", true),
  // Test Clerk B: refused settings, deletes, and Remove (no inventory.delete)
  ...GUARDED.filter((g) => g.clerk).map(refusedFor("clerk")),
  // Test Sender B can't see cost (pages.quotes without quotes.edit)
  catalogList("sender", "allowed", false),
  {
    name: "Distributor search, without dealer pricing",
    actor: "sender",
    kind: "allowed",
    method: "GET",
    path: () => "/api/distributor-search?q=test",
    expect: 200,
    contains: () => ["products"],
    check: (json) => offersWithoutPricing(json),
  },

  // ── Shared sender mode (Quote Settings sends from Test Admin B's mailbox) ──
  {
    name: "Send options in shared mode: shared mailbox for everyone",
    actor: "sender",
    kind: "allowed",
    sharedMode: "admin",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.canChooseSender) return "canChooseSender should be false"
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the shared mailbox"
      if (o.options.length !== 1 || !o.options[0].isShared) return "options should hold only the shared mailbox, marked shared"
      return null
    },
  },
  {
    name: "Send options in shared mode: holder sees the shared mailbox marked",
    actor: "admin",
    kind: "allowed",
    sharedMode: "admin",
    method: "GET",
    path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the shared mailbox"
      const shared = o.options.find((x) => x.connectionId === c.fx.adminMailboxId)
      return shared?.isShared ? null : "the shared mailbox should be marked isShared"
    },
  },
  // ── Number prefixes (round two, N-25): letters, digits, and hyphens only ──
  { name: "Quote number prefix with a quote and a space", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/quote-settings", body: () => ({ quotePrefix: 'Q "bad"' }), expect: 400, expectError: "Quote number prefix can only use" },
  { name: "Sales order number prefix with a space", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/so-po-settings", body: () => ({ soPrefix: "S O" }), expect: 400, expectError: "Sales order number prefix can only use" },
  { name: "Purchase order number prefix over 10 characters", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/so-po-settings", body: () => ({ poPrefix: "PURCHASEORD" }), expect: 400, expectError: "Purchase order number prefix can only use" },
  // ── Quote copy (quote correctness): a client and contact of this company are required ──
  { name: "Copy without a client or contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, expect: 400, expectError: "A client is required" },
  { name: "Copy with a client but no contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.fx.copyClientId }), expect: 400, expectError: "A contact is required" },
  { name: "Copy for another company's client", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.c.clientId, contactId: c.c.contactId }), expect: 400, expectError: "Invalid client" },
  { name: "Copy with another company's contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.c.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Copy with a contact of a different client", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.fx.copyContactId }), expect: 400, expectError: "Invalid contact" },
  // ── Default Expiry (quote correctness): blank, 0, negative, and fractional are refused ──
  ...(["", null, 0, "0", -5, 2.5] as const).map((value): Attempt => ({
    name: `Default Expiry of ${JSON.stringify(value)}`,
    actor: "admin",
    kind: "refused",
    method: "PATCH",
    path: () => "/api/quote-settings",
    body: () => ({ quoteExpiryDays: value }),
    expect: 400,
    expectError: "Default expiry must be a whole number of days, 1 or more",
  })),
  // ── Template lines (round two, #80): a bad recurring interval is a 400 ──
  { name: "Template line with a made up recurring interval", actor: "templater", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items/${c.fx.costTemplateLineId}`, body: () => ({ recurringInterval: "WEEKLY" }), expect: 400, expectError: "Invalid recurring interval" },

  // ── Opportunities ──
  // Test Everyone B: refused every opportunity, stage, type, and settings route
  ...OPP_GUARDED.map(refusedFor("everyone")),
  // Test Rep B (Opportunities page and create, no see all, no edit or
  // delete): only its own and unassigned opportunities, only itself or
  // nobody as owner, and no settings writes
  { name: "Open the admin's opportunity", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "The admin's opportunity attachments", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/attachments`, expect: 404, expectError: "Not found" },
  { name: "The admin's opportunity timeline", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline`, expect: 404, expectError: "Not found" },
  { name: "Add a note to own opportunity (no edit)", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expect: 403, expectError: "edit opportunities" },
  { name: "The admin's opportunity related records", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/related`, expect: 404, expectError: "Not found" },
  { name: "Create an opportunity owned by the admin", actor: "rep", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: c.b.adminId }), expect: 403, expectError: "You can only assign opportunities to yourself or leave them unassigned" },
  { name: "Edit own opportunity", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit opportunities" },
  { name: "Delete own opportunity", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 403, expectError: "delete opportunities" },
  ...OPP_GUARDED.filter((g) => g.expectError === OPP_SETTINGS_WRITE).map(refusedFor("rep")),
  {
    name: "Create an opportunity for self (then removed)",
    actor: "rep",
    kind: "allowed",
    method: "POST",
    path: () => "/api/opportunities",
    body: (c) => ({ title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId }),
    expect: 200,
    check: createdOpportunityOwnedBy((c) => c.repUserId),
  },
  {
    name: "Create an unassigned opportunity (then removed)",
    actor: "rep",
    kind: "allowed",
    method: "POST",
    path: () => "/api/opportunities",
    body: (c) => ({ title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: null }),
    expect: 200,
    check: createdOpportunityOwnedBy(() => null),
  },
  // Test Opp Viewer B (only the Opportunities page): reads, never writes
  { name: "Open the admin's opportunity", actor: "oppViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Create an opportunity", actor: "oppViewer", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 403, expectError: "create opportunities" },
  { name: "Edit an opportunity", actor: "oppViewer", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit opportunities" },
  { name: "Delete an opportunity", actor: "oppViewer", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 403, expectError: "delete opportunities" },
  { name: "Upload an opportunity attachment", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expect: 403, expectError: "edit opportunities" },
  { name: "Delete an opportunity attachment", actor: "oppViewer", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments/${c.fx.unassignedOpportunityAttachmentId}`, expect: 403, expectError: "edit opportunities" },
  ...OPP_GUARDED.filter((g) => g.expectError === OPP_SETTINGS_WRITE).map(refusedFor("oppViewer")),
  // Test Opp Settings B (only Opportunity Settings): no opportunities themselves
  { name: "List opportunities", actor: "oppSettings", kind: "refused", method: "GET", path: () => "/api/opportunities", expect: 403, expectError: "view opportunities" },
  { name: "Opportunity timeline", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expect: 403, expectError: "view opportunities" },
  { name: "Add an opportunity note", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expect: 403, expectError: "edit opportunities" },
  { name: "Add a note that changes the stage", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.fx.opportunityStageIds[1] }), expect: 403, expectError: "edit opportunities" },
  // Opportunity details: the client's phone and locations and the contact's
  // details only reach users who may open the opportunity
  { name: "Client details of the admin's opportunity", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Client details without the Opportunities page", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 403, expectError: "view opportunities" },
  // A note's stageId is checked like any body id
  { name: "Note with another company's stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.c.opportunityStageId }), expect: 400, expectError: "Invalid stage" },
  { name: "Note with a made up stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.fakeId }), expect: 400, expectError: "Invalid stage" },
  { name: "Note with a stage that isn't text", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>", stageId: 42 }), expect: 400, expectError: "Invalid stage" },
  // Timeline notes: only their author edits or deletes them (Global Admin
  // included), and recorded actions never change
  { name: "Edit another user's note", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedRepNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 403, expectError: "your own notes" },
  { name: "Delete another user's note", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedRepNoteId}`, expect: 403, expectError: "your own notes" },
  { name: "Edit an action entry", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedActionId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 403, expectError: "Only notes" },
  { name: "Delete an action entry", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedActionId}`, expect: 403, expectError: "Only notes" },
  { name: "Save own note empty", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p></p>" }), expect: 400, expectError: "can't be empty" },
  { name: "Note under another opportunity", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 404, expectError: "Not found" },
  { name: "Timeline page with another opportunity's cursor", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline?cursor=${c.fx.unassignedAdminNoteId}`, expect: 400, expectError: "Invalid cursor" },
  { name: "Opportunity related records", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expect: 403, expectError: "view opportunities" },
  { name: "Create an opportunity", actor: "oppSettings", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 403, expectError: "create opportunities" },

  { name: "Disconnect someone else's shared mailbox", actor: "sender", kind: "refused", sharedMode: "admin", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },
  // Even one's own mailbox needs Integrations access while it is the shared sender
  { name: "Disconnect own mailbox while it is the shared sender", actor: "sender", kind: "refused", sharedMode: "sender", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.senderMailboxId}`, expect: 403, expectError: "shared quote sender" },
]

// ─── HARNESS ─────────────────────────────────────────────────────────────────

// Everything an attempt could touch in Test Company B (and Test Company C's
// mailboxes, for the cross company sender attempt), compared before and
// after each refused attempt that isn't a GET. No token or secret columns
// are read.
async function snapshot(prisma: PrismaClient, b: string, c: string): Promise<Record<string, string>> {
  const byId = { orderBy: { id: "asc" as const } }
  const sections = {
    quotes: prisma.quote.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, approvals: byId },
    }),
    quoteTemplates: prisma.quoteTemplate.findMany({ where: { companyId: b }, ...byId, include: { lineItems: byId } }),
    mailboxes: prisma.microsoftConnection.findMany({
      where: { companyId: { in: [b, c] } },
      ...byId,
      select: { id: true, companyId: true, email: true, label: true, connectedByUserId: true, updatedAt: true },
    }),
    // updatedAt moves on any write to company settings, secrets included
    settings: prisma.companySettings.findUnique({
      where: { companyId: b },
      select: { quoteSendFromMode: true, quoteSendFromConnectionId: true, updatedAt: true },
    }),
    company: prisma.company.findUnique({ where: { id: b }, select: { name: true, logoUrl: true, secondaryLogoUrl: true } }),
    salesOrders: prisma.salesOrder.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    purchaseOrders: prisma.purchaseOrder.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    approvalWorkflows: prisma.approvalWorkflow.findMany({ where: { companyId: b }, ...byId }),
    distributorIntegrations: prisma.distributorIntegration.findMany({
      where: { companyId: b },
      ...byId,
      select: { id: true, distributor: true, enabled: true, updatedAt: true },
    }),
    dashboards: prisma.dashboard.findMany({ where: { companyId: b }, ...byId, include: { widgets: byId } }),
    roles: prisma.role.findMany({ where: { companyId: b }, ...byId }),
    clients: prisma.client.findMany({
      where: { companyId: b },
      ...byId,
      include: { contacts: { ...byId, include: { tags: true } }, locations: byId },
    }),
    vendors: prisma.vendor.findMany({
      where: { companyId: b },
      ...byId,
      include: { contacts: byId, locations: byId },
    }),
    vendorAttachments: prisma.vendorAttachment.findMany({ where: { vendor: { companyId: b } }, ...byId }),
    catalogItems: prisma.catalogItem.findMany({ where: { companyId: b }, ...byId }),
    catalogChangeLogs: prisma.catalogItemChangeLog.count({ where: { catalogItem: { companyId: b } } }),
    categories: prisma.category.findMany({ where: { companyId: b }, ...byId }),
    customFields: prisma.inventoryCustomField.findMany({ where: { companyId: b }, ...byId }),
    industries: prisma.industry.findMany({ where: { companyId: b }, ...byId }),
    contactTags: prisma.contactTag.findMany({ where: { companyId: b }, ...byId }),
    inventoryAssets: prisma.inventoryAsset.findMany({ where: { companyId: b }, ...byId }),
    assetAttachments: prisma.inventoryAssetAttachment.findMany({ where: { asset: { companyId: b } }, ...byId }),
    assetEvents: prisma.inventoryAssetEvent.count({ where: { asset: { companyId: b } } }),
    containers: prisma.inventoryLocation.findMany({ where: { companyId: b }, ...byId }),
    stock: prisma.inventoryStock.findMany({ where: { companyId: b }, ...byId }),
    stockEvents: prisma.inventoryStockEvent.count({ where: { stock: { companyId: b } } }),
    users: prisma.user.findMany({
      where: { companyId: b },
      ...byId,
      select: { id: true, name: true, active: true, roleId: true, loginLockedUntil: true },
    }),
    notifications: prisma.notification.count({ where: { companyId: b } }),
    opportunities: prisma.opportunity.findMany({ where: { companyId: b }, ...byId, include: { attachments: byId, timeline: byId } }),
    opportunityStages: prisma.opportunityStage.findMany({ where: { companyId: b }, ...byId }),
    opportunityTypes: prisma.opportunityType.findMany({ where: { companyId: b }, ...byId }),
    opportunitySettings: prisma.opportunitySettings.findUnique({ where: { companyId: b } }),
  }
  const keys = Object.keys(sections) as (keyof typeof sections)[]
  const values = await Promise.all(keys.map((k) => sections[k]))
  return Object.fromEntries(keys.map((k, i) => [k, JSON.stringify(values[i])]))
}

function changedSections(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after).filter((k) => before[k] !== after[k])
}

// Test Sender B inside Test Company B, made for this run, with its own
// mailbox row (placeholder tokens). The password exists only in memory for
// this run.
async function ensureSenderFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const senderPermissions = { pages: { quotes: true }, quotes: { sendEmail: true, viewAllUsersQuotes: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.senderRole, rank: 6, permissions: senderPermissions })
  const userId = await addRunUser(prisma, run, { companyId, name: n.senderName, email: n.senderEmail, roleIds: [roleId] })
  const mailboxId = await addRunMailbox(prisma, run, { companyId, email: n.senderMailboxEmail, label: n.senderName, connectedByUserId: userId })

  return { email: n.senderEmail, mailboxId }
}

// Test Viewer B inside Test Company B: both order pages and both viewAll
// keys, no edit, so it opens every order without seeing cost. Made for this
// run, password in memory only.
async function ensureViewerFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const viewerPermissions = {
    pages: { salesOrders: true, purchaseOrders: true },
    salesOrders: { viewAll: true },
    purchaseOrders: { viewAll: true },
  }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.viewerRole, rank: 1, permissions: viewerPermissions })
  await addRunUser(prisma, run, { companyId, name: n.viewerName, email: n.viewerEmail, roleIds: [roleId] })

  return { email: n.viewerEmail }
}

// Test Manager B inside Test Company B: manages users (Manage Users) but
// is not a Global Admin, for the invite rank rule. It also opens the
// Settings page (no API route reads pages.settings), so the page checks
// see a Settings user without Opportunity Settings. Made for this run,
// password in memory only.
async function ensureManagerFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const managerPermissions = { pages: { settings: true }, settingsSections: { users: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.managerRole, rank: 5, permissions: managerPermissions })
  await addRunUser(prisma, run, { companyId, name: n.managerName, email: n.managerEmail, roleIds: [roleId] })

  return { email: n.managerEmail, roleId }
}

// An ad hoc line (no catalog item, so not inventory tracked) on Test
// Orders B's purchase order, not yet received. Removed at the end of the run.
async function ensureUntrackedPoLine(prisma: PrismaClient, fx: PermissionFixtureIds, names: TestNames) {
  const name = names.untrackedPoLine
  const existing = await prisma.pOLineItem.findFirst({ where: { purchaseOrderId: fx.ordersPurchaseOrderId, name }, select: { id: true } })
  if (existing) {
    await prisma.pOLineItem.update({ where: { id: existing.id }, data: { received: false, catalogItemId: null } })
    return existing.id
  }
  const created = await prisma.pOLineItem.create({
    data: { purchaseOrderId: fx.ordersPurchaseOrderId, name, quantity: 1, unitCost: 1, received: false },
    select: { id: true },
  })
  return created.id
}

// A held email whose send fails must not strand the quote. Runs as Test
// Admin B on its own sample quote, using the sample approval workflow
// switched on for the duration, and puts everything back at the end.
async function checkHeldEmailApproval(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const label = (name: string) => `[Admin B] Held email: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  try {
    // Every send of this company's quotes now needs approval
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null },
    })

    const send = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const heldQuote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, pendingEmailPayload: true } })
    const heldOk = send.status === 200 && send.text.includes('"pendingApproval":true') && heldQuote.status === "PENDING_APPROVAL"
    row("send is held for approval", "200, PENDING_APPROVAL", `${send.status}, ${heldQuote.status}`, heldOk ? null : errorText(send.text))
    if (!heldOk) return

    const approval = await prisma.quoteApproval.findFirst({ where: { quoteId, workflowId, status: "PENDING" }, select: { id: true } })
    if (!approval) {
      row("approval was requested", "a pending approval", "none", "no pending approval was created")
      return
    }

    // The send can't succeed (no Microsoft credentials), so this is the failed send path
    const approve = await admin.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, pendingEmailPayload: true } })
    const decided = await prisma.quoteApproval.findUniqueOrThrow({ where: { id: approval.id }, select: { status: true } })
    const kept = after.pendingEmailPayload as { lastSendError?: string } | null
    let warning = ""
    try {
      warning = (JSON.parse(approve.text) as { warning?: string }).warning ?? ""
    } catch {
      // not JSON, reported below
    }
    const problem =
      approve.status !== 200
        ? `approve returned ${approve.status}: ${errorText(approve.text)}`
        : !warning
          ? "no warning in the response"
          : decided.status !== "APPROVED"
            ? `approval is ${decided.status}`
            : after.status !== "DRAFT"
              ? `quote is ${after.status}`
              : !kept?.lastSendError
                ? "the held email was not kept"
                : null
    row("failed send keeps the approval and the email", "200 with warning, APPROVED, DRAFT", `${approve.status}, ${decided.status}, ${after.status}`, problem)

    const again = await admin.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    const unchanged = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    row(
      "approving again is refused",
      '400 "already been decided"',
      String(again.status),
      again.status === 400 && errorText(again.text).includes("already been decided") && unchanged.status === "DRAFT"
        ? null
        : `got ${again.status} (${errorText(again.text)}), quote is ${unchanged.status}`
    )

    // The owner sending it again counts the approval already granted: it is
    // not held a second time (and still can't go out without credentials)
    const resend = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const resent = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    const pendingAgain = await prisma.quoteApproval.count({ where: { quoteId, status: "PENDING" } })
    row(
      "owner resend is not held again",
      "400 (no credentials), DRAFT, no new approval",
      `${resend.status}, ${resent.status}, ${pendingAgain} pending`,
      resend.status === 400 && resent.status === "DRAFT" && pendingAgain === 0 ? null : errorText(resend.text)
    )
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: {
        active: workflow.active,
        triggerType: workflow.triggerType,
        thresholdValue: workflow.thresholdValue,
        triggerUserId: workflow.triggerUserId,
      },
    })
    await prisma.quoteApproval.deleteMany({ where: { quoteId } })
    await prisma.quote.update({ where: { id: quoteId }, data: { status: "DRAFT", pendingEmailPayload: Prisma.JsonNull } })
  }
}

// Test Approver B inside Test Company B: the Quotes page and approving,
// not a Global Admin, so it decides an approval it didn't request. Made for
// this run, password in memory only.
async function ensureApproverFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const approverPermissions = { pages: { quotes: true }, quotes: { approve: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.approverRole, rank: 7, permissions: approverPermissions })
  await addRunUser(prisma, run, { companyId, name: n.approverName, email: n.approverEmail, roleIds: [roleId] })

  return { email: n.approverEmail, roleId }
}

// The quote fields the round two steps below change, for every version of
// Test Company B's sample quote, so each step can put them back exactly
const SAMPLE_QUOTE_FIELDS = {
  id: true,
  status: true,
  sentAt: true,
  viewedAt: true,
  acceptedAt: true,
  declinedAt: true,
  isActive: true,
  terms: true,
  useDefaultTerms: true,
  internalNotes: true,
  pendingEmailPayload: true,
} as const

async function saveSampleQuote(prisma: PrismaClient, quoteId: string) {
  const q = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { companyId: true, quoteNumber: true } })
  return prisma.quote.findMany({ where: { companyId: q.companyId, quoteNumber: q.quoteNumber }, select: SAMPLE_QUOTE_FIELDS })
}

async function restoreSampleQuote(prisma: PrismaClient, saved: Awaited<ReturnType<typeof saveSampleQuote>>) {
  for (const { id, pendingEmailPayload, ...fields } of saved) {
    await prisma.quote.update({
      where: { id },
      data: { ...fields, pendingEmailPayload: pendingEmailPayload === null ? Prisma.DbNull : (pendingEmailPayload as Prisma.InputJsonValue) },
    })
  }
}

// Round two, N-1: changing a draft quote's status by hand runs the same
// approval workflow check as Send Quote. Runs as Test Admin B (who holds
// quotes.changeStatus) on its own sample quote, with the sample workflow
// switched on and then off, and puts everything back.
async function checkStatusApproval(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const label = (name: string) => `[Admin B] Status needs approval: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const status = (s: string) => admin.request("POST", `/api/quotes/${quoteId}/status`, { json: { status: s } })
  const current = async () => (await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })).status

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  const saved = await saveSampleQuote(prisma, quoteId)
  const salesOrdersBefore = await prisma.salesOrder.count({ where: { quoteId } })
  try {
    // Every quote of the company now needs approval
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null },
    })
    for (const target of ["SENT", "ACCEPTED"]) {
      const res = await status(target)
      const now = await current()
      const ok = res.status === 400 && errorText(res.text).includes("needs approval before it can be changed") && now === "DRAFT"
      row(`${target} with an active workflow is refused`, '400 "needs approval", still DRAFT', `${res.status}, ${now}`, ok ? null : errorText(res.text))
    }
    const madeSalesOrder = (await prisma.salesOrder.count({ where: { quoteId } })) !== salesOrdersBefore
    row("refused ACCEPTED made no sales order", "no new sales order", madeSalesOrder ? "a sales order" : "none", madeSalesOrder ? "a sales order was created" : null)

    const declined = await status("DECLINED")
    const afterDecline = await current()
    row("DECLINED is always allowed", "200, DECLINED", `${declined.status}, ${afterDecline}`, declined.status === 200 && afterDecline === "DECLINED" ? null : errorText(declined.text))
    await restoreSampleQuote(prisma, saved)

    // With the workflow off, the same change goes through as before
    await prisma.approvalWorkflow.update({ where: { id: workflowId }, data: { active: false } })
    const sent = await status("SENT")
    const afterSend = await current()
    row("SENT with the workflow off is allowed", "200, SENT", `${sent.status}, ${afterSend}`, sent.status === 200 && afterSend === "SENT" ? null : errorText(sent.text))
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: workflow.active, triggerType: workflow.triggerType, thresholdValue: workflow.thresholdValue, triggerUserId: workflow.triggerUserId },
    })
    await restoreSampleQuote(prisma, saved)
  }
}

// Round two, N-2: a quote changed after approval was requested is not sent
// when the approval comes in. Test Admin B requests approval with an email
// (it can't go out: the test company has no Microsoft credentials), changes
// a line price through the API, and Test Approver B approves. Everything is
// put back, the notification it makes included.
async function checkStaleApproval(
  prisma: PrismaClient,
  admin: Session,
  approver: Session,
  approverRoleId: string,
  ctx: AttemptContext,
  rows: Row[]
) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const lineId = ctx.b.quoteLineId
  const label = (name: string) => `[Admin B, Approver B] Stale approval: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  const line = await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: lineId }, select: { unitPrice: true } })
  const saved = await saveSampleQuote(prisma, quoteId)
  const startedAt = new Date()
  try {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null, requiredRoleId: approverRoleId },
    })
    const send = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const held = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    const heldOk = send.status === 200 && held.status === "PENDING_APPROVAL"
    row("send is held for approval", "200, PENDING_APPROVAL", `${send.status}, ${held.status}`, heldOk ? null : errorText(send.text))
    if (!heldOk) return

    const edit = await admin.request("PATCH", `/api/quotes/${quoteId}/line-items/${lineId}`, { json: { unitPrice: line.unitPrice + 1 } })
    row("owner changes a line price while pending", "200", String(edit.status), edit.status === 200 ? null : errorText(edit.text))

    const approval = await prisma.quoteApproval.findFirst({ where: { quoteId, workflowId, status: "PENDING" }, select: { id: true } })
    if (!approval) {
      row("approval was requested", "a pending approval", "none", "no pending approval was created")
      return
    }
    const approve = await approver.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    let body: { warning?: string; stale?: boolean } = {}
    try {
      body = JSON.parse(approve.text)
    } catch {
      // reported below
    }
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, sentAt: true, pendingEmailPayload: true } })
    const kept = after.pendingEmailPayload as { to?: string; approvalStale?: boolean; approvedFingerprint?: string } | null
    const notified = await prisma.notification.count({ where: { link: `/dashboard/quotes/${quoteId}`, createdAt: { gte: startedAt } } })
    const problem =
      approve.status !== 200
        ? `approve returned ${approve.status}: ${errorText(approve.text)}`
        : !body.stale || !body.warning?.includes("changed after approval was requested")
          ? "no stale warning in the response"
          : after.status !== "DRAFT" || after.sentAt
            ? `quote is ${after.status}${after.sentAt ? " and was marked sent" : ""}`
            : !kept?.to
              ? "the held email was not kept"
              : !kept.approvalStale || kept.approvedFingerprint
                ? "the approvals still count"
                : notified === 0
                  ? "the owner was not notified"
                  : null
    row("approving a changed quote does not send it", "200 stale warning, DRAFT, email kept, owner notified", `${approve.status}, ${after.status}`, problem)
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: {
        active: workflow.active,
        triggerType: workflow.triggerType,
        thresholdValue: workflow.thresholdValue,
        triggerUserId: workflow.triggerUserId,
        requiredRoleId: workflow.requiredRoleId,
      },
    })
    await prisma.quoteLineItem.update({ where: { id: lineId }, data: { unitPrice: line.unitPrice } })
    await prisma.quoteApproval.deleteMany({ where: { quoteId } })
    await prisma.notification.deleteMany({ where: { link: `/dashboard/quotes/${quoteId}`, createdAt: { gte: startedAt } } })
    await restoreSampleQuote(prisma, saved)
  }
}

// Round two, #56: a sales order lists only the linked purchase orders the
// user may open. Test Company B's second sample purchase order (owned by
// Test Admin B) is linked to Test Orders B's sales order for the step and
// unlinked afterwards.
async function checkSalesOrderLinkedPurchaseOrders(prisma: PrismaClient, admin: Session, orders: Session, ctx: AttemptContext, rows: Row[]) {
  const poId = ctx.b.purchaseOrder2Id
  const soId = ctx.fx.ordersSalesOrderId
  const label = (who: string, name: string) => `[${who}] Linked purchase orders: ${name}`
  const original = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { salesOrderId: true } })
  try {
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { salesOrderId: soId } })

    const asOrders = await orders.request("GET", `/api/sales-orders/${soId}`)
    let count = -1
    try {
      count = (JSON.parse(asOrders.text) as { _count?: { purchaseOrders?: number } })._count?.purchaseOrders ?? -1
    } catch {
      // reported below
    }
    const ordersProblem =
      asOrders.status !== 200
        ? `got ${asOrders.status}: ${errorText(asOrders.text)}`
        : asOrders.text.includes(poId)
          ? "the admin's purchase order is in the response"
          : count < 1
            ? "the linked purchase order count is missing"
            : null
    rows.push({
      attempt: label("Orders B", "another user's purchase order is not shown"),
      expected: "200 without the admin's purchase order",
      actual: String(asOrders.status),
      result: ordersProblem ? "FAIL" : "PASS",
      note: ordersProblem ?? undefined,
    })

    const asAdmin = await admin.request("GET", `/api/sales-orders/${soId}`)
    const adminProblem = asAdmin.status !== 200 ? `got ${asAdmin.status}` : !asAdmin.text.includes(poId) ? "the purchase order is missing" : null
    rows.push({
      attempt: label("Admin B", "Global Admin still sees it"),
      expected: "200 with the purchase order",
      actual: String(asAdmin.status),
      result: adminProblem ? "FAIL" : "PASS",
      note: adminProblem ?? undefined,
    })
  } finally {
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { salesOrderId: original.salesOrderId } })
  }
}

// Page guards for the Opportunities screens. Pages answer 200 either way,
// so each one is read as HTML with the user's session: a refused page holds
// the NoAccess text (rendered on the server), an allowed one doesn't. The
// Settings page lists only the sections a user may use, so Opportunity
// Settings is allowed when its entry is listed. (Its ?panel= link is applied
// in the browser, so the server's HTML shows the first listed section.)
const NO_ACCESS_PAGE = "You do not have access to this page"
const OPP_SETTINGS_ENTRY = "Opportunity Settings"

async function checkOpportunityPages(sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  const pages: { name: string; path: string; allowed: Actor[]; refused: Actor[]; settings?: true }[] = [
    { name: "Opportunities page", path: "/dashboard/opportunities?view=list", allowed: ["admin", "rep", "oppViewer"], refused: ["everyone", "oppSettings", "clerk"] },
    {
      name: "Opportunity page",
      path: `/dashboard/opportunities/${ctx.fx.unassignedOpportunityId}`,
      allowed: ["admin", "rep", "oppViewer"],
      refused: ["everyone", "oppSettings", "clerk"],
    },
    // Test Manager B opens Settings without Opportunity Settings
    { name: "Settings > Opportunity Settings", path: "/dashboard/settings?panel=opportunities", allowed: ["admin", "oppSettings"], refused: ["everyone", "manager", "oppViewer"], settings: true },
  ]
  for (const page of pages) {
    for (const [actor, allowed] of [...page.allowed.map((a) => [a, true] as const), ...page.refused.map((a) => [a, false] as const)]) {
      const res = await sessions[actor].request("GET", page.path)
      const pageRefused = res.text.includes(NO_ACCESS_PAGE)
      const opens = !pageRefused && (!page.settings || res.text.includes(OPP_SETTINGS_ENTRY))
      const problem =
        res.status !== 200
          ? `got ${res.status}${res.location ? ` to ${res.location}` : ""}`
          : allowed && !opens
            ? pageRefused
              ? "the page shows no access"
              : "the Opportunity Settings section is not listed"
            : !allowed && opens
              ? "the page opened"
              : null
      rows.push({
        attempt: `[${labels[actor]}] ${page.name}`,
        expected: allowed ? "200, opens" : "200, no access",
        actual: res.status === 200 ? (opens ? "200, opens" : "200, no access") : String(res.status),
        result: problem ? "FAIL" : "PASS",
        note: problem ?? undefined,
      })
    }
  }
}

// The Related panel lists only what the user may open. The admin's sample
// quote and Test Rep B's quote are linked to the unassigned sample
// opportunity for the step and unlinked afterwards. Test Admin B (Global
// Admin) sees both, Test Rep B (own quotes only) only its own, and Test
// Opp Viewer B (no Quotes page) neither.
async function checkRelatedVisibility(prisma: PrismaClient, sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const adminQuoteId = ctx.b.quoteId
  const repQuoteId = ctx.fx.repQuoteId
  const original = await prisma.quote.findMany({ where: { id: { in: [adminQuoteId, repQuoteId] } }, select: { id: true, opportunityId: true } })
  try {
    await prisma.quote.updateMany({ where: { id: { in: [adminQuoteId, repQuoteId] } }, data: { opportunityId } })

    const cases: { actor: Actor; sees: string[]; hidden: string[] }[] = [
      { actor: "admin", sees: [adminQuoteId, repQuoteId], hidden: [] },
      { actor: "rep", sees: [repQuoteId], hidden: [adminQuoteId] },
      { actor: "oppViewer", sees: [], hidden: [adminQuoteId, repQuoteId] },
    ]
    for (const c of cases) {
      const res = await sessions[c.actor].request("GET", `/api/opportunities/${opportunityId}/related`)
      let quoteIds: string[] | null = null
      try {
        quoteIds = ((JSON.parse(res.text) as { quotes?: { id: string }[] }).quotes ?? []).map((q) => q.id)
      } catch {
        // reported below
      }
      const missing = c.sees.filter((id) => !quoteIds?.includes(id))
      const leaked = c.hidden.filter((id) => res.text.includes(id))
      const problem =
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : quoteIds === null
            ? "no quotes list in the response"
            : leaked.length > 0
              ? `shows a quote the user may not open (${leaked.join(", ")})`
              : missing.length > 0
                ? `missing a linked quote the user may open (${missing.join(", ")})`
                : null
      rows.push({
        attempt: `[${labels[c.actor]}] Related panel lists only quotes it may open`,
        expected: `200 with ${c.sees.length} linked quote${c.sees.length === 1 ? "" : "s"}`,
        actual: String(res.status),
        result: problem ? "FAIL" : "PASS",
        note: problem ?? undefined,
      })
    }
  } finally {
    for (const q of original) await prisma.quote.update({ where: { id: q.id }, data: { opportunityId: q.opportunityId } })
  }
}

// A stage's category change sets or clears closedAt on its opportunities.
// Test Opp Settings B moves the company's first stage (New, OPEN, where
// all three sample opportunities sit, and not the quote sent stage) to WON
// and back. The stage and every closedAt are put back afterwards.
async function checkStageCategoryClosedAt(prisma: PrismaClient, oppSettings: Session, ctx: AttemptContext, rows: Row[]) {
  const stageId = ctx.fx.opportunityStageIds[0]
  const label = (name: string) => `[Opp Settings B] Stage category change: ${name}`
  const stage = await prisma.opportunityStage.findUniqueOrThrow({ where: { id: stageId }, select: { category: true } })
  const settings = await prisma.opportunitySettings.findUniqueOrThrow({ where: { companyId: ctx.b.companyId }, select: { quoteSentStageId: true } })
  const original = await prisma.opportunity.findMany({ where: { companyId: ctx.b.companyId, stageId }, select: { id: true, closedAt: true } })
  if (stage.category !== "OPEN" || settings.quoteSentStageId === stageId || original.length === 0) {
    rows.push({ attempt: label("fixture"), expected: "an OPEN stage with opportunities", actual: stage.category, result: "UNEXPECTED", note: "the first stage isn't as the run data set it up" })
    return
  }
  const ids = original.map((o) => o.id)
  try {
    const toWon = await oppSettings.request("PATCH", `/api/opportunity-stages/${stageId}`, { json: { category: "WON" } })
    const closed = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { closedAt: true } })
    const wonProblem =
      toWon.status !== 200 ? `got ${toWon.status}: ${errorText(toWon.text)}` : closed.some((o) => o.closedAt === null) ? "an opportunity in the stage has no closedAt" : null
    rows.push({ attempt: label("OPEN to WON sets closedAt"), expected: `200, ${ids.length} closed`, actual: String(toWon.status), result: wonProblem ? "FAIL" : "PASS", note: wonProblem ?? undefined })

    const toOpen = await oppSettings.request("PATCH", `/api/opportunity-stages/${stageId}`, { json: { category: "OPEN" } })
    const reopened = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { closedAt: true } })
    const openProblem =
      toOpen.status !== 200 ? `got ${toOpen.status}: ${errorText(toOpen.text)}` : reopened.some((o) => o.closedAt !== null) ? "an opportunity in the stage still has a closedAt" : null
    rows.push({ attempt: label("WON back to OPEN clears closedAt"), expected: `200, ${ids.length} open`, actual: String(toOpen.status), result: openProblem ? "FAIL" : "PASS", note: openProblem ?? undefined })
  } finally {
    await prisma.opportunityStage.update({ where: { id: stageId }, data: { category: "OPEN" } })
    for (const o of original) await prisma.opportunity.update({ where: { id: o.id }, data: { closedAt: o.closedAt } })
  }
}

// The opportunity timeline, on the unassigned sample opportunity as Test
// Admin B: a note holding a script tag is stored and returned without it,
// its author edits it (editedAt set) and deletes it, a stage change through
// PATCH adds exactly one stage_changed entry, and a PATCH that changes
// nothing adds none. The stage, its dates, and every entry the step added
// are put back afterwards.
async function checkTimeline(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const base = `/api/opportunities/${opportunityId}`
  const label = (name: string) => `[Admin B] Timeline: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, stageChangedAt: true, closedAt: true, title: true } })
  const otherStageId = ctx.fx.opportunityStageIds.find((s) => s !== original.stageId)
  const count = (where: Prisma.TimelineEntryWhereInput = {}) => prisma.timelineEntry.count({ where: { opportunityId, ...where } })
  let noteId: string | null = null
  try {
    // A script tag is stripped on save and on the way out, the text kept
    const add = await admin.request("POST", `${base}/timeline`, { json: { body: "<p>Dev check note</p><script>window.devCheck = 1</script>" } })
    noteId = add.status === 200 ? ((JSON.parse(add.text) as { id?: string }).id ?? null) : null
    const stored = noteId ? await prisma.timelineEntry.findUnique({ where: { id: noteId }, select: { body: true, kind: true, authorId: true } }) : null
    push(
      "a note with a script tag is saved without it",
      "200, no script stored or returned",
      String(add.status),
      add.status !== 200 || !stored
        ? `got ${add.status}: ${errorText(add.text)}`
        : /<script/i.test(stored.body ?? "") || /<script/i.test(add.text)
          ? "the script tag was kept"
          : !(stored.body ?? "").includes("Dev check note")
            ? "the note text was lost"
            : stored.kind !== "NOTE" || stored.authorId !== ctx.b.adminId
              ? "not saved as the admin's note"
              : null
    )
    if (!noteId) return

    const listed = await admin.request("GET", `${base}/timeline`)
    push("the timeline returns it first, without the script", "200, the new note first", String(listed.status),
      listed.status !== 200 ? `got ${listed.status}` : /<script/i.test(listed.text) ? "a script tag was returned" : (JSON.parse(listed.text) as { entries: { id: string }[] }).entries[0]?.id !== noteId ? "the new note is not first" : null)

    const edit = await admin.request("PATCH", `${base}/timeline/${noteId}`, { json: { body: "<p>Dev check note, edited</p>" } })
    const edited = await prisma.timelineEntry.findUnique({ where: { id: noteId }, select: { body: true, editedAt: true } })
    push("its author edits it", "200, editedAt set", String(edit.status),
      edit.status !== 200 ? `got ${edit.status}: ${errorText(edit.text)}` : !edited?.editedAt || !edited.body?.includes("edited") ? "the edit was not saved" : null)

    const del = await admin.request("DELETE", `${base}/timeline/${noteId}`)
    const gone = (await prisma.timelineEntry.count({ where: { id: noteId } })) === 0
    push("its author deletes it", "200, gone", String(del.status), del.status !== 200 ? `got ${del.status}: ${errorText(del.text)}` : !gone ? "the note is still there" : null)
    if (gone) noteId = null

    if (otherStageId) {
      const beforeAll = await count()
      const beforeStage = await count({ action: "stage_changed" })
      const move = await admin.request("PATCH", base, { json: { stageId: otherStageId } })
      const addedAll = (await count()) - beforeAll
      const addedStage = (await count({ action: "stage_changed" })) - beforeStage
      push("a stage change adds one stage_changed entry", "200, exactly 1 entry", `${move.status}, ${addedAll} added`,
        move.status !== 200 ? `got ${move.status}: ${errorText(move.text)}` : addedAll !== 1 || addedStage !== 1 ? `added ${addedAll} entries, ${addedStage} stage_changed` : null)
    }

    const beforeSame = await count()
    const same = await admin.request("PATCH", base, { json: { title: original.title } })
    const addedSame = (await count()) - beforeSame
    push("a PATCH that changes nothing adds none", "200, 0 entries", `${same.status}, ${addedSame} added`,
      same.status !== 200 ? `got ${same.status}: ${errorText(same.text)}` : addedSame !== 0 ? `added ${addedSame} entries` : null)
  } finally {
    if (noteId) await prisma.timelineEntry.deleteMany({ where: { id: noteId } })
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, kind: "ACTION", createdAt: { gte: startedAt } } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { stageId: original.stageId, stageChangedAt: original.stageChangedAt, closedAt: original.closedAt } })
  }
}

// A note posted with a stageId moves the unassigned sample opportunity:
// to a WON stage (closedAt set), then back to an OPEN one (closedAt
// cleared), each adding exactly one entry, the NOTE, which holds the move.
// The stage, its dates, and the notes are put back afterwards.
async function checkNoteStageChange(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const label = (name: string) => `[Admin B] Note with a stage change: ${name}`
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, stageChangedAt: true, closedAt: true } })
  const won = await prisma.opportunityStage.findFirst({ where: { companyId: ctx.b.companyId, category: "WON" }, select: { id: true } })
  const open = await prisma.opportunityStage.findFirst({ where: { companyId: ctx.b.companyId, category: "OPEN", id: { not: original.stageId } }, select: { id: true } })
  if (!won || !open) {
    rows.push({ attempt: label("fixture"), expected: "a WON and another OPEN stage", actual: "missing", result: "UNEXPECTED", note: "the run data's stages aren't as set up" })
    return
  }
  try {
    for (const step of [
      { name: "to WON sets closedAt", stageId: won.id, closed: true },
      { name: "back to OPEN clears closedAt", stageId: open.id, closed: false },
    ]) {
      const before = await prisma.timelineEntry.count({ where: { opportunityId } })
      const res = await admin.request("POST", `/api/opportunities/${opportunityId}/timeline`, { json: { body: `<p>Dev check stage note</p>`, stageId: step.stageId } })
      const after = await prisma.timelineEntry.findMany({ where: { opportunityId, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" }, select: { kind: true, data: true } })
      const added = (await prisma.timelineEntry.count({ where: { opportunityId } })) - before
      const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, closedAt: true } })
      const change = (after[0]?.data as { stageChange?: { to?: { id?: string } } } | null)?.stageChange
      const problem =
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : opp.stageId !== step.stageId
            ? "the stage did not change"
            : step.closed !== (opp.closedAt !== null)
              ? step.closed
                ? "closedAt was not set"
                : "closedAt was not cleared"
              : added !== 1
                ? `added ${added} entries, expected 1`
                : after[0]?.kind !== "NOTE" || change?.to?.id !== step.stageId
                  ? "the note doesn't hold the stage change"
                  : null
      rows.push({ attempt: label(step.name), expected: "200, stage moved, 1 entry", actual: `${res.status}, ${added} added`, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
    }
  } finally {
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, createdAt: { gte: startedAt } } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { stageId: original.stageId, stageChangedAt: original.stageChangedAt, closedAt: original.closedAt } })
  }
}

// Every line field a copy carries over (all but id, quoteId, createdAt)
const COPIED_LINE_FIELDS = [
  "catalogItemId", "section", "sortOrder", "name", "description", "sku", "quantity", "unitPrice", "cost", "discount", "taxable",
  "isRecurring", "recurringInterval", "isOptional", "optionalSelected", "quantityAdjustable", "choiceGroup", "isTextBlock",
  "bundleName", "bundleDisplayMode", "isBundleHeader",
] as const

// Quote correctness: a copy is a faithful duplicate of the quote's lines
// and sections, made for the client and contact picked for it, owned by
// whoever copied it, and leaves the original's PO number, internal notes,
// and progress behind. Test Admin B copies the copy fixture quote (every
// kind of line) for the copy client, then copies that copy for the sample
// client, and Test Rep B copies its own quote. Every copy made here is
// deleted at the end, its lines with it.
async function checkQuoteCopy(prisma: PrismaClient, admin: Session, rep: Session, ctx: AttemptContext, rows: Row[]) {
  const row = (who: string, name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[${who}] Quote copy: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const made: string[] = []
  async function copy(session: Session, quoteId: string, body: { clientId: string; contactId: string }) {
    const res = await session.request("POST", `/api/quotes/${quoteId}/copy`, { json: body })
    const id = res.status === 200 ? (JSON.parse(res.text) as { id?: string }).id : undefined
    if (id) made.push(id)
    return { res, id }
  }
  // The lines in the order the quote shows them, as the fields a copy keeps
  async function linesOf(quoteId: string) {
    const lines = await prisma.quoteLineItem.findMany({
      where: { quoteId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    return lines.map((l) => JSON.stringify(COPIED_LINE_FIELDS.map((f) => l[f])))
  }
  async function compare(who: string, name: string, sourceId: string, copyId: string) {
    const [a, b] = await Promise.all([linesOf(sourceId), linesOf(copyId)])
    const differs = a.length !== b.length ? `${b.length} lines instead of ${a.length}` : a.findIndex((l, i) => l !== b[i]) >= 0 ? `line ${a.findIndex((l, i) => l !== b[i]) + 1} differs` : null
    row(who, `${name} has the same lines`, `${a.length} identical lines`, `${b.length} lines`, differs)
    const lines = await prisma.quoteLineItem.findMany({ where: { quoteId: copyId } })
    const children = lines.filter((l) => l.bundleName && !l.isBundleHeader)
    const bundled = children.length > 0 && children.every((c) => lines.some((h) => h.isBundleHeader && h.bundleName === c.bundleName && h.section === c.section))
    const group = lines.filter((l) => l.choiceGroup)
    const selected = group.filter((l) => l.optionalSelected).length
    const structure = !bundled ? "bundle children without their header" : group.length < 2 || selected !== 1 ? "choice group lost its selected option" : null
    row(who, `${name} keeps the bundle and choice group`, "children under the new header, one option selected", `${children.length} children, ${group.length} options, ${selected} selected`, structure)
  }

  try {
    const source = await prisma.quote.findUniqueOrThrow({
      where: { id: ctx.fx.copyQuoteId },
      select: { sections: true, quoteNumber: true, accessToken: true, internalAccessToken: true },
    })

    // Admin B copies the fixture quote for the copy client
    const first = await copy(admin, ctx.fx.copyQuoteId, { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId })
    row("Admin B", "copy for another client", "200", String(first.res.status), first.id ? null : errorText(first.res.text))
    if (first.id) {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: first.id } })
      const problems = [
        q.clientId !== ctx.fx.copyClientId && "client is not the chosen one",
        q.contactId !== ctx.fx.copyContactId && "contact is not the chosen one",
        q.userId !== ctx.b.adminId && "not owned by the copier",
        q.status !== "DRAFT" && `status ${q.status}`,
        (q.sentAt || q.viewedAt || q.acceptedAt) && "carries the original's progress",
        q.clientPoNumber !== null && "kept the PO number",
        q.internalNotes !== null && "kept the internal notes",
        q.paymentTerms !== ctx.names.copyClientPaymentTerms && `payment terms ${q.paymentTerms} instead of the new client's`,
        q.shipAddress !== "2 Copy Street" && "ship to is not the new client's",
        JSON.stringify(q.sections) !== JSON.stringify(source.sections) && "section list differs",
        q.quoteNumber === source.quoteNumber && "same quote number",
        (q.accessToken === source.accessToken || q.internalAccessToken === source.internalAccessToken) && "same links",
        !q.expiresAt || q.expiresAt.getTime() <= Date.now() ? "no future expiry" : false,
      ].filter(Boolean)
      row("Admin B", "copy takes only the details and items", "new client, contact, owner, draft", problems.length ? "differs" : "as expected", problems.length ? problems.join(", ") : null)
      await compare("Admin B", "copy", ctx.fx.copyQuoteId, first.id)

      // A copy of the copy, for the sample client
      const second = await copy(admin, first.id, { clientId: ctx.b.clientId, contactId: ctx.b.contactId })
      row("Admin B", "copy of a copy", "200", String(second.res.status), second.id ? null : errorText(second.res.text))
      if (second.id) await compare("Admin B", "copy of a copy", ctx.fx.copyQuoteId, second.id)
    }

    // Test Rep B copies its own quote, and owns the copy
    const repCopy = await copy(rep, ctx.fx.repQuoteId, { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId })
    row("Rep B", "copy own quote", "200", String(repCopy.res.status), repCopy.id ? null : errorText(repCopy.res.text))
    if (repCopy.id) {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: repCopy.id }, select: { userId: true } })
      row("Rep B", "the copy is the rep's", "owned by Test Rep B", q.userId === ctx.repUserId ? "Test Rep B" : "someone else", q.userId === ctx.repUserId ? null : "not owned by the copier")
      const opened = await rep.request("GET", `/api/quotes/${repCopy.id}`)
      row("Rep B", "the rep can open the copy", "200", String(opened.status), opened.status === 200 ? null : errorText(opened.text))
    }
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: made } } })
  }
}

function expectedText(a: Attempt) {
  if (a.location) return `${a.expect} to ${a.location}`
  return `${a.expect}${a.expectError ? ` "${a.expectError}"` : ""}`
}

async function judgeSuccess(a: Attempt, res: { status: number; text: string; location: string }, ctx: AttemptContext, prisma: PrismaClient) {
  if (res.status !== a.expect) return `got ${res.status}: ${errorText(res.text)}`
  if (a.location && !res.location.includes(a.location)) return `redirected to ${res.location || "nowhere"}`
  const missing = (a.contains?.(ctx) ?? []).filter((t) => !res.text.includes(t))
  if (missing.length > 0) return `response is missing ${missing.slice(0, 3).join(", ")}`
  const present = (a.notContains?.(ctx) ?? []).filter((t) => res.text.includes(t))
  if (present.length > 0) return `response must not contain ${present.slice(0, 3).join(", ")}`
  if (a.check) {
    let json: unknown
    try {
      json = JSON.parse(res.text)
    } catch {
      return "response is not JSON"
    }
    return await a.check(json, ctx, prisma)
  }
  return null
}

function judgeRefusal(a: Attempt, res: { status: number; text: string }, changed: string[]): Pick<Row, "result" | "note"> {
  const message = errorText(res.text)
  if (changed.length > 0) return { result: "FAIL", note: `data changed: ${changed.join(", ")}` }
  if (res.status >= 200 && res.status < 300) return { result: "FAIL", note: `request succeeded: ${message}` }
  if (res.status >= 500) return { result: "FAIL", note: `server error: ${message}` }
  if (res.status === a.expect) {
    if (!isJsonError(res.text)) return { result: "UNEXPECTED", note: "not a JSON refusal from the app, the route path may be wrong" }
    if (a.expectError && !message.includes(a.expectError)) return { result: "UNEXPECTED", note: `refused for a different reason: ${message}` }
    return { result: "PASS" }
  }
  if (res.status === 401) return { result: "UNEXPECTED", note: `not signed in: ${message}` }
  if (res.status >= 300 && res.status < 400) return { result: "UNEXPECTED", note: "redirected, the harness may not be signed in" }
  if (res.status === 403 || res.status === 404 || res.status === 400) {
    return { result: "UNEXPECTED", note: `refused, but with ${res.status}: ${message}` }
  }
  return { result: "FAIL", note: `wrong refusal: ${message}` }
}

// Runs every attempt against this run's data and returns the result (exit code 0
// all passed, 1 a FAIL or UNEXPECTED). A broken harness throws HarnessBroken.
export async function checkPermissions(prisma: PrismaClient, run: RunData, baseUrl: string): Promise<CheckResult> {
  const rows: Row[] = []

  const b = run.companies.B.ids
  const c = run.companies.C.ids
  const fx = run.companies.B.fixtures
  const fxC = run.companies.C.fixtures
  const names = run.companies.B.names

  // Safety: with no Microsoft credentials and no distributor turned on, a
  // quote email can't be sent and no real distributor can be reached from
  // these companies even if a refusal below were broken
  const external = await findExternalServices(prisma, [b.companyId, c.companyId])
  if (external) throw new HarnessBroken(external)
  const quotes = await prisma.quote.findMany({ where: { id: { in: [b.quoteId, fx.repQuoteId] } }, select: { status: true } })
  if (quotes.length !== 2 || quotes.some((q) => q.status !== "DRAFT")) {
    throw new HarnessBroken("The sample quotes must be drafts, so this run's data isn't as it was set up.")
  }

  // Creator mode for the run, put back the way it was at the end
  const originalSettings = await prisma.companySettings.findUnique({
    where: { companyId: b.companyId },
    select: { quoteSendFromMode: true, quoteSendFromConnectionId: true },
  })
  async function setSenderMode(mode: "CREATOR" | "SPECIFIC", connectionId: string | null) {
    await prisma.companySettings.upsert({
      where: { companyId: b.companyId },
      update: { quoteSendFromMode: mode, quoteSendFromConnectionId: connectionId },
      create: { companyId: b.companyId, quoteSendFromMode: mode, quoteSendFromConnectionId: connectionId },
    })
  }
  try {
    return await runChecks()
  } finally {
    await setSenderMode(
      originalSettings?.quoteSendFromMode === "SPECIFIC" ? "SPECIFIC" : "CREATOR",
      originalSettings?.quoteSendFromConnectionId ?? null
    )
    // The ad hoc purchase order line exists only for this run
    await prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: fx.ordersPurchaseOrderId, name: names.untrackedPoLine } })
  }

  async function runChecks() {
    await setSenderMode("CREATOR", null)
    const sender = await ensureSenderFixture(prisma, run)
    const viewer = await ensureViewerFixture(prisma, run)
    const manager = await ensureManagerFixture(prisma, run)
    const untrackedPoLineId = await ensureUntrackedPoLine(prisma, fx, names)
    const ctx: AttemptContext = {
      b,
      c,
      fx,
      fxC,
      names,
      namesC: run.companies.C.names,
      senderMailboxId: sender.mailboxId,
      repUserId: fx.repUserId,
      managerRoleId: manager.roleId,
      untrackedPoLineId,
      fakeId: "devonlynotarealid000000000",
    }

    // Sign in, once per user for the whole check
    const sessions: Record<Actor, Session> = {
      admin: new Session("Test Admin B", baseUrl),
      rep: new Session("Test Rep B", baseUrl),
      clerk: new Session("Test Clerk B", baseUrl),
      everyone: new Session("Test Everyone B", baseUrl),
      sender: new Session("Test Sender B", baseUrl),
      orders: new Session("Test Orders B", baseUrl),
      templater: new Session("Test Templater B", baseUrl),
      viewer: new Session("Test Viewer B", baseUrl),
      manager: new Session("Test Manager B", baseUrl),
      oppViewer: new Session("Test Opp Viewer B", baseUrl),
      oppSettings: new Session("Test Opp Settings B", baseUrl),
    }
    await run.credentials.signIn(sessions.admin, names.adminEmail)
    await run.credentials.signIn(sessions.rep, names.repEmail)
    await run.credentials.signIn(sessions.everyone, names.everyoneEmail)
    await run.credentials.signIn(sessions.clerk, names.clerkEmail)
    await run.credentials.signIn(sessions.sender, sender.email)
    await run.credentials.signIn(sessions.orders, names.ordersEmail)
    await run.credentials.signIn(sessions.templater, names.templaterEmail)
    await run.credentials.signIn(sessions.viewer, viewer.email)
    await run.credentials.signIn(sessions.manager, manager.email)
    await run.credentials.signIn(sessions.oppViewer, names.oppViewerEmail)
    await run.credentials.signIn(sessions.oppSettings, names.oppSettingsEmail)
    console.log(
      `Signed in to ${baseUrl} as Test Admin B, Test Rep B, Test Clerk B, Test Everyone B, Test Sender B, Test Orders B, Test Templater B, Test Viewer B, Test Manager B, Test Opp Viewer B, and Test Opp Settings B.`
    )

    const ACTOR_LABEL: Record<Actor, string> = {
      admin: "Admin B",
      rep: "Rep B",
      clerk: "Clerk B",
      everyone: "Everyone B",
      sender: "Sender B",
      orders: "Orders B",
      templater: "Templater B",
      viewer: "Viewer B",
      manager: "Manager B",
      oppViewer: "Opp Viewer B",
      oppSettings: "Opp Settings B",
    }
    const label = (a: Attempt) => `[${a.kind === "control" ? "control " : ""}${ACTOR_LABEL[a.actor]}] ${a.name}`

    // Positive controls first: if any fails, the refusals below would prove nothing
    for (const a of ATTEMPTS.filter((x) => x.kind === "control" && !x.sharedMode)) {
      const res = await sessions[a.actor].request(a.method, a.path(ctx), { json: a.body?.(ctx) })
      const problem = await judgeSuccess(a, res, ctx, prisma)
      rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
      if (problem) {
        printTable(rows)
        throw new HarnessBroken(`Positive control "${label(a)}" failed, so the harness itself is broken. No other attempts were run.`)
      }
    }

    async function runAttempts(list: Attempt[]) {
      let before = await snapshot(prisma, b.companyId, c.companyId)
      for (const a of list) {
        let res: { status: number; text: string; location: string }
        try {
          res = await sessions[a.actor].request(a.method, a.path(ctx), { json: a.body?.(ctx) })
        } catch (err) {
          // The server stopped answering: no later attempt can run either
          if (err instanceof ServerUnreachable) throw err
          rows.push({ attempt: label(a), expected: expectedText(a), actual: "no response", result: "UNEXPECTED", note: err instanceof Error ? err.message : String(err) })
          continue
        }

        if (a.kind === "refused") {
          let changed: string[] = []
          if (a.method !== "GET") {
            const after = await snapshot(prisma, b.companyId, c.companyId)
            changed = changedSections(before, after)
            before = after
          }
          rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), ...judgeRefusal(a, res, changed) })
        } else {
          const problem = await judgeSuccess(a, res, ctx, prisma)
          rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
          // Allowed requests may legitimately write (a no-op save still moves
          // updatedAt), so the next refused attempt compares against now
          before = await snapshot(prisma, b.companyId, c.companyId)
        }
      }
    }

    await runAttempts(ATTEMPTS.filter((a) => a.kind !== "control" && !a.sharedMode))

    // Shared sender mode, one shared mailbox at a time
    await setSenderMode("SPECIFIC", fx.adminMailboxId)
    await runAttempts(ATTEMPTS.filter((a) => a.sharedMode === "admin"))
    await setSenderMode("SPECIFIC", sender.mailboxId)
    await runAttempts(ATTEMPTS.filter((a) => a.sharedMode === "sender"))

    // Approval of a held email whose send fails
    await setSenderMode("CREATOR", null)
    await checkHeldEmailApproval(prisma, sessions.admin, ctx, rows)

    // Round two: a manual status change needs approval (N-1), a quote
    // changed after approval was requested is not sent (N-2), and a sales
    // order shows only the purchase orders the user may open (#56)
    await checkStatusApproval(prisma, sessions.admin, ctx, rows)
    const approverFixture = await ensureApproverFixture(prisma, run)
    const approver = new Session("Test Approver B", baseUrl)
    await run.credentials.signIn(approver, approverFixture.email)
    await checkStaleApproval(prisma, sessions.admin, approver, approverFixture.roleId, ctx, rows)
    await checkSalesOrderLinkedPurchaseOrders(prisma, sessions.admin, sessions.orders, ctx, rows)

    // Quote correctness: copies reproduce every line and get the chosen client
    await checkQuoteCopy(prisma, sessions.admin, sessions.rep, ctx, rows)

    // Opportunities screens: page guards, the Related panel's visibility,
    // and closedAt following a stage's category
    await checkOpportunityPages(sessions, ACTOR_LABEL, ctx, rows)
    await checkRelatedVisibility(prisma, sessions, ACTOR_LABEL, ctx, rows)
    await checkStageCategoryClosedAt(prisma, sessions.oppSettings, ctx, rows)
    await checkTimeline(prisma, sessions.admin, ctx, rows)
    await checkNoteStageChange(prisma, sessions.admin, ctx, rows)

    printTable(rows)
    const count = (r: Row["result"]) => rows.filter((row) => row.result === r).length
    console.log(`\n${rows.length} checks: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("UNEXPECTED")} UNEXPECTED`)

    return checkResult(rows)
  }
}

// On its own: this check's own temporary data, set up and removed around it
async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  return withRunData("check-permissions", (prisma, run) => checkPermissions(prisma, run, baseUrl))
}

if (isEntryScript("check-permissions")) {
  main()
    .then((result) => process.exit(result.code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(err instanceof HarnessBroken ? 2 : 1)
    })
}
