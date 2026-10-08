// DEV ONLY. Proves multi company isolation against the locally running dev
// server: signs in as Test Admin B and Test Admin C (made by
// create-test-companies.ts) and tries to read and change the OTHER
// company's records, expecting every attempt to be refused.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts), and only
// talks to a server on this machine. Run from the repo root, with the dev
// server running and both passwords set in the shell (never in a file):
//   TEST_ADMIN_B_PASSWORD=... TEST_ADMIN_C_PASSWORD=... npx tsx scripts/dev-only/check-cross-company.ts --yes
// Optional: --base-url http://localhost:3000 (the default)
//
// Order of work: guard, sign in, positive controls on each user's OWN
// records (if any fails the harness itself is broken and nothing else
// runs), then every attempt below in both directions, then the
// deactivated user check. Any FAIL or UNEXPECTED exits non zero.

import bcrypt from "bcryptjs"
import type { PrismaClient } from "@/generated/prisma"
import { enforceDevGuard } from "./lib/guard"
import { BCRYPT_COST, generatePassword, loadSampleIds, testNames, type SampleIds, type TestLetter } from "./lib/test-data"
// Only imports Prisma types, so loading it can't reach the database
import { setUserRoles } from "@/lib/user-roles"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("check-cross-company")

// ─── ATTEMPTS ────────────────────────────────────────────────────────────────
// Every cross company attempt, in one list. To cover a new route in a later
// phase, add an entry here.
//
//   own / other     sample ids of the signed in user's company and of the
//                   other company. "both" attempts run twice, as B against C
//                   and as C against B. "once" attempts run as B only.
//   expect          404 for an id in the URL from another company (or another
//                   parent), 400 for a foreign id sent in the body, 403 only
//                   where a refusal is the point (role escalation).
//   expectError     text the refusal must contain, so a 400 for some other
//                   reason (a malformed test body) can't pass as a refusal.
//   multipart       sends a form with no file, so an attachment upload that
//                   wrongly got past the scope check fails with "No file
//                   provided" instead of uploading anything.

interface AttemptContext {
  own: SampleIds
  other: SampleIds
  ownNames: ReturnType<typeof testNames>
  // Only for B, from the role escalation fixture
  targetRoleId: string
}

type Method = "GET" | "POST" | "PATCH" | "DELETE"

interface Attempt {
  name: string
  directions: "both" | "once"
  actor?: "admin" | "limited"
  method: Method
  path: (c: AttemptContext) => string
  body?: (c: AttemptContext) => unknown
  multipart?: boolean
  // Uses only the caller's own company's records, labeled B->B or C->C
  sameCompany?: boolean
  expect: 400 | 403 | 404
  expectError?: string
}

const FAR_FUTURE = "2030-01-01"

const ATTEMPTS: Attempt[] = [
  // ── Nested records, other company's ids in the URL ──
  { name: "GET other company's client", directions: "both", method: "GET", path: (c) => `/api/clients/${c.other.clientId}`, expect: 404 },
  { name: "POST contact on other client", directions: "both", method: "POST", path: (c) => `/api/clients/${c.other.clientId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expect: 404 },
  { name: "PATCH other client's contact", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.other.clientId}/contacts/${c.other.contactId}`, body: () => ({ firstName: "Changed", lastName: "Changed" }), expect: 404 },
  { name: "PATCH other contact under own client", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/contacts/${c.other.contactId}`, body: () => ({ firstName: "Changed", lastName: "Changed" }), expect: 404 },
  { name: "POST location on other client", directions: "both", method: "POST", path: (c) => `/api/clients/${c.other.clientId}/locations`, body: () => ({ name: "Should Not Exist" }), expect: 404 },
  { name: "PATCH other client's location", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.other.clientId}/locations/${c.other.clientLocationId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "PATCH other location under own client", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/locations/${c.other.clientLocationId}`, body: () => ({ name: "Changed" }), expect: 404 },

  { name: "GET other vendor's attachments", directions: "both", method: "GET", path: (c) => `/api/vendors/${c.other.vendorId}/attachments`, expect: 404 },
  { name: "POST attachment to other vendor", directions: "both", method: "POST", path: (c) => `/api/vendors/${c.other.vendorId}/attachments`, multipart: true, expect: 404 },
  { name: "DELETE other vendor's attachment", directions: "both", method: "DELETE", path: (c) => `/api/vendors/${c.other.vendorId}/attachments/${c.other.vendorAttachmentId}`, expect: 404 },
  { name: "DELETE other attachment under own vendor", directions: "both", method: "DELETE", path: (c) => `/api/vendors/${c.own.vendorId}/attachments/${c.other.vendorAttachmentId}`, expect: 404 },
  { name: "POST contact on other vendor", directions: "both", method: "POST", path: (c) => `/api/vendors/${c.other.vendorId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expect: 404 },
  { name: "PATCH other vendor's contact", directions: "both", method: "PATCH", path: (c) => `/api/vendors/${c.other.vendorId}/contacts/${c.other.vendorContactId}`, body: () => ({ firstName: "Changed" }), expect: 404 },
  { name: "PATCH other vendor contact under own vendor", directions: "both", method: "PATCH", path: (c) => `/api/vendors/${c.own.vendorId}/contacts/${c.other.vendorContactId}`, body: () => ({ firstName: "Changed" }), expect: 404 },
  { name: "PATCH other vendor's location", directions: "both", method: "PATCH", path: (c) => `/api/vendors/${c.other.vendorId}/locations/${c.other.vendorLocationId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "PATCH other vendor location under own vendor", directions: "both", method: "PATCH", path: (c) => `/api/vendors/${c.own.vendorId}/locations/${c.other.vendorLocationId}`, body: () => ({ name: "Changed" }), expect: 404 },

  { name: "GET other catalog item's change log", directions: "both", method: "GET", path: (c) => `/api/catalog/${c.other.catalogItemId}/change-log`, expect: 404 },

  { name: "GET other company's inventory asset", directions: "both", method: "GET", path: (c) => `/api/inventory-assets/${c.other.assetId}`, expect: 404 },
  { name: "Check out other company's asset", directions: "both", method: "POST", path: (c) => `/api/inventory-assets/${c.other.assetId}/checkout`, body: (c) => ({ type: "INTERNAL", userId: c.own.adminId }), expect: 404 },
  { name: "GET other asset's attachments", directions: "both", method: "GET", path: (c) => `/api/inventory-assets/${c.other.assetId}/attachments`, expect: 404 },
  { name: "POST attachment to other asset", directions: "both", method: "POST", path: (c) => `/api/inventory-assets/${c.other.assetId}/attachments`, multipart: true, expect: 404 },
  { name: "DELETE other asset's attachment", directions: "both", method: "DELETE", path: (c) => `/api/inventory-assets/${c.other.assetId}/attachments/${c.other.assetAttachmentId}`, expect: 404 },
  { name: "DELETE other attachment under own asset", directions: "both", method: "DELETE", path: (c) => `/api/inventory-assets/${c.own.assetId}/attachments/${c.other.assetAttachmentId}`, expect: 404 },

  { name: "POST line item on other sales order", directions: "both", method: "POST", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404 },
  { name: "PATCH other sales order's line item", directions: "both", method: "PATCH", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/line-items/${c.other.soLineId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "DELETE other sales order's line item", directions: "both", method: "DELETE", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/line-items/${c.other.soLineId}`, expect: 404 },
  { name: "PATCH other SO line item under own sales order", directions: "both", method: "PATCH", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/line-items/${c.other.soLineId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "DELETE other SO line item under own sales order", directions: "both", method: "DELETE", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/line-items/${c.other.soLineId}`, expect: 404 },
  { name: "GET other sales order's comments", directions: "both", method: "GET", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/comments`, expect: 404 },
  { name: "POST comment on other sales order", directions: "both", method: "POST", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404 },
  { name: "GET other sales order's attachments", directions: "both", method: "GET", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/attachments`, expect: 404 },
  { name: "POST attachment to other sales order", directions: "both", method: "POST", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/attachments`, multipart: true, expect: 404 },
  { name: "DELETE other sales order's attachment", directions: "both", method: "DELETE", path: (c) => `/api/sales-orders/${c.other.salesOrderId}/attachments/${c.other.soAttachmentId}`, expect: 404 },
  { name: "DELETE other SO attachment under own sales order", directions: "both", method: "DELETE", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/attachments/${c.other.soAttachmentId}`, expect: 404 },

  { name: "POST line item on other purchase order", directions: "both", method: "POST", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404 },
  { name: "PATCH other purchase order's line item", directions: "both", method: "PATCH", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/line-items/${c.other.poLineId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "DELETE other purchase order's line item", directions: "both", method: "DELETE", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/line-items/${c.other.poLineId}`, expect: 404 },
  { name: "PATCH other PO line item under own purchase order", directions: "both", method: "PATCH", path: (c) => `/api/purchase-orders/${c.own.purchaseOrderId}/line-items/${c.other.poLineId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "DELETE other PO line item under own purchase order", directions: "both", method: "DELETE", path: (c) => `/api/purchase-orders/${c.own.purchaseOrderId}/line-items/${c.other.poLineId}`, expect: 404 },
  { name: "Receive other purchase order's line item", directions: "both", method: "POST", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/line-items/${c.other.poLineId}/receive`, body: () => ({}), expect: 404 },
  { name: "GET other purchase order's comments", directions: "both", method: "GET", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/comments`, expect: 404 },
  { name: "POST comment on other purchase order", directions: "both", method: "POST", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404 },
  { name: "GET other purchase order's attachments", directions: "both", method: "GET", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/attachments`, expect: 404 },
  { name: "POST attachment to other purchase order", directions: "both", method: "POST", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/attachments`, multipart: true, expect: 404 },
  { name: "DELETE other purchase order's attachment", directions: "both", method: "DELETE", path: (c) => `/api/purchase-orders/${c.other.purchaseOrderId}/attachments/${c.other.poAttachmentId}`, expect: 404 },
  { name: "DELETE other PO attachment under own purchase order", directions: "both", method: "DELETE", path: (c) => `/api/purchase-orders/${c.own.purchaseOrderId}/attachments/${c.other.poAttachmentId}`, expect: 404 },
  // Same company: a line item from the first PO with the second PO's id in the URL
  { name: "PATCH own PO line item under own second PO", directions: "both", sameCompany: true, method: "PATCH", path: (c) => `/api/purchase-orders/${c.own.purchaseOrder2Id}/line-items/${c.own.poLineId}`, body: () => ({ name: "Changed" }), expect: 404 },
  { name: "DELETE own PO line item under own second PO", directions: "both", sameCompany: true, method: "DELETE", path: (c) => `/api/purchase-orders/${c.own.purchaseOrder2Id}/line-items/${c.own.poLineId}`, expect: 404 },

  { name: "PATCH other company's Everyone role", directions: "both", method: "PATCH", path: (c) => `/api/roles/${c.other.everyoneRoleId}`, body: () => ({ permissions: { quotes: { delete: true } } }), expect: 404 },

  // ── Body ids: the caller's OWN parent record, the OTHER company's ids ──
  { name: "Client PATCH mainBillingLocationId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}`, body: (c) => ({ mainBillingLocationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Client PATCH mainShippingLocationId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}`, body: (c) => ({ mainShippingLocationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Client PATCH industryId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}`, body: (c) => ({ industryId: c.other.industryId }), expect: 400, expectError: "Invalid industry" },
  { name: "Client location POST billingContactId", directions: "both", method: "POST", path: (c) => `/api/clients/${c.own.clientId}/locations`, body: (c) => ({ name: "Should Not Exist", billingContactId: c.other.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Client location POST shippingContactId", directions: "both", method: "POST", path: (c) => `/api/clients/${c.own.clientId}/locations`, body: (c) => ({ name: "Should Not Exist", shippingContactId: c.other.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Client location PATCH billingContactId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/locations/${c.own.clientLocationId}`, body: (c) => ({ name: c.ownNames.clientLocation, billingContactId: c.other.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Client location PATCH shippingContactId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/locations/${c.own.clientLocationId}`, body: (c) => ({ name: c.ownNames.clientLocation, shippingContactId: c.other.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Client contact POST tagIds", directions: "both", method: "POST", path: (c) => `/api/clients/${c.own.clientId}/contacts`, body: (c) => ({ firstName: "Should", lastName: "Not Exist", tagIds: [c.other.contactTagId] }), expect: 400, expectError: "Invalid tag" },
  { name: "Client contact POST locationId", directions: "both", method: "POST", path: (c) => `/api/clients/${c.own.clientId}/contacts`, body: (c) => ({ firstName: "Should", lastName: "Not Exist", locationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Client contact PATCH tagIds", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/contacts/${c.own.contactId}`, body: (c) => ({ firstName: c.ownNames.contactFirstName, lastName: c.ownNames.contactLastName, locationType: "IN_OFFICE", tagIds: [c.other.contactTagId] }), expect: 400, expectError: "Invalid tag" },
  { name: "Client contact PATCH locationId", directions: "both", method: "PATCH", path: (c) => `/api/clients/${c.own.clientId}/contacts/${c.own.contactId}`, body: (c) => ({ firstName: c.ownNames.contactFirstName, lastName: c.ownNames.contactLastName, locationType: "IN_OFFICE", locationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Vendor contact POST locationId", directions: "both", method: "POST", path: (c) => `/api/vendors/${c.own.vendorId}/contacts`, body: (c) => ({ firstName: "Should", lastName: "Not Exist", locationId: c.other.vendorLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Vendor contact PATCH locationId", directions: "both", method: "PATCH", path: (c) => `/api/vendors/${c.own.vendorId}/contacts/${c.own.vendorContactId}`, body: (c) => ({ locationId: c.other.vendorLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Catalog POST vendorId", directions: "both", method: "POST", path: () => "/api/catalog", body: (c) => ({ name: "Should Not Exist", categoryId: c.own.categoryId, vendorId: c.other.vendorId }), expect: 400, expectError: "Invalid vendor" },
  { name: "Catalog POST manufacturerId", directions: "both", method: "POST", path: () => "/api/catalog", body: (c) => ({ name: "Should Not Exist", categoryId: c.own.categoryId, manufacturerId: c.other.vendorId }), expect: 400, expectError: "Invalid manufacturer" },
  { name: "Catalog PATCH vendorId", directions: "both", method: "PATCH", path: (c) => `/api/catalog/${c.own.catalogItemId}`, body: (c) => ({ name: c.ownNames.catalogItem, categoryId: c.own.categoryId, vendorId: c.other.vendorId }), expect: 400, expectError: "Invalid vendor" },
  { name: "Catalog PATCH manufacturerId", directions: "both", method: "PATCH", path: (c) => `/api/catalog/${c.own.catalogItemId}`, body: (c) => ({ name: c.ownNames.catalogItem, categoryId: c.own.categoryId, manufacturerId: c.other.vendorId }), expect: 400, expectError: "Invalid manufacturer" },
  { name: "Inventory asset POST (loaned) clientLocationId", directions: "both", method: "POST", path: () => "/api/inventory-assets", body: (c) => ({ catalogItemId: c.own.catalogItemId, serialNumber: "SHOULD-NOT-EXIST", status: "LOANED", loanedToClientId: c.own.clientId, loanedToContactId: c.own.contactId, loanExpectedReturnDate: FAR_FUTURE, clientLocationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Inventory asset POST customFieldId", directions: "both", method: "POST", path: () => "/api/inventory-assets", body: (c) => ({ catalogItemId: c.own.catalogItemId, serialNumber: "SHOULD-NOT-EXIST", status: "IN_STOCK", clientId: c.own.clientId, clientLocationId: c.own.clientLocationId, customFieldValues: [{ customFieldId: c.other.customFieldId, value: "x" }] }), expect: 400, expectError: "Invalid custom field" },
  { name: "Inventory asset PATCH customFieldId", directions: "both", method: "PATCH", path: (c) => `/api/inventory-assets/${c.own.assetId}`, body: (c) => ({ serialNumber: c.ownNames.assetSerial, customFieldValues: [{ customFieldId: c.other.customFieldId, value: "x" }] }), expect: 400, expectError: "Invalid custom field" },
  { name: "Checkout (sold) clientLocationId", directions: "both", method: "POST", path: (c) => `/api/inventory-assets/${c.own.assetId}/checkout`, body: (c) => ({ type: "SOLD", clientId: c.own.clientId, clientLocationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Checkout (loaned) clientLocationId", directions: "both", method: "POST", path: (c) => `/api/inventory-assets/${c.own.assetId}/checkout`, body: (c) => ({ type: "LOANED", clientId: c.own.clientId, contactId: c.own.contactId, loanExpectedReturnDate: FAR_FUTURE, clientLocationId: c.other.clientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Quote POST clientId", directions: "both", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.other.clientId }), expect: 400, expectError: "Invalid client" },
  { name: "Quote POST contactId", directions: "both", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.own.clientId, contactId: c.other.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Quote POST userId", directions: "both", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.own.clientId, userId: c.other.adminId }), expect: 400, expectError: "Invalid user" },
  { name: "Quote POST templateId", directions: "both", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.own.clientId, templateId: c.other.templateId }), expect: 400, expectError: "Invalid template" },
  { name: "Quote line item POST catalogItemId", directions: "both", method: "POST", path: (c) => `/api/quotes/${c.own.quoteId}/line-items`, body: (c) => ({ name: "Should Not Exist", catalogItemId: c.other.catalogItemId }), expect: 400, expectError: "Invalid catalog item" },
  { name: "Quote template line item POST catalogItemId", directions: "both", method: "POST", path: (c) => `/api/quote-templates/${c.own.templateId}/line-items`, body: (c) => ({ name: "Should Not Exist", catalogItemId: c.other.catalogItemId }), expect: 400, expectError: "Invalid catalog item" },
  { name: "Approval workflow POST requiredRoleId", directions: "both", method: "POST", path: () => "/api/approval-workflows", body: (c) => ({ name: "Should Not Exist", triggerType: "TOTAL_THRESHOLD", thresholdValue: 1, requiredRoleId: c.other.globalAdminRoleId }), expect: 400, expectError: "Invalid role" },
  { name: "Approval workflow POST triggerUserId", directions: "both", method: "POST", path: () => "/api/approval-workflows", body: (c) => ({ name: "Should Not Exist", triggerType: "SPECIFIC_USER", requiredRoleId: c.own.globalAdminRoleId, triggerUserId: c.other.adminId }), expect: 400, expectError: "Invalid user" },
  { name: "Approval workflow PATCH requiredRoleId", directions: "both", method: "PATCH", path: (c) => `/api/approval-workflows/${c.own.workflowId}`, body: (c) => ({ requiredRoleId: c.other.globalAdminRoleId }), expect: 400, expectError: "Invalid role" },
  { name: "Approval workflow PATCH triggerUserId", directions: "both", method: "PATCH", path: (c) => `/api/approval-workflows/${c.own.workflowId}`, body: (c) => ({ triggerUserId: c.other.adminId }), expect: 400, expectError: "Invalid user" },
  { name: "Sales order POST clientId", directions: "both", method: "POST", path: () => "/api/sales-orders", body: (c) => ({ clientId: c.other.clientId }), expect: 400, expectError: "Invalid client" },
  { name: "SO line item POST catalogItemId", directions: "both", method: "POST", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/line-items`, body: (c) => ({ name: "Should Not Exist", catalogItemId: c.other.catalogItemId }), expect: 400, expectError: "Invalid catalog item" },
  { name: "SO line item POST vendorId", directions: "both", method: "POST", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/line-items`, body: (c) => ({ name: "Should Not Exist", vendorId: c.other.vendorId }), expect: 400, expectError: "Invalid vendor" },
  { name: "SO line item PATCH vendorId", directions: "both", method: "PATCH", path: (c) => `/api/sales-orders/${c.own.salesOrderId}/line-items/${c.own.soLineId}`, body: (c) => ({ vendorId: c.other.vendorId }), expect: 400, expectError: "Invalid vendor" },
  { name: "Purchase order POST salesOrderId", directions: "both", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.own.vendorId, salesOrderId: c.other.salesOrderId }), expect: 400, expectError: "Invalid sales order" },
  // This route already looked the vendor up within the company before this
  // phase, and answers a foreign vendor with 404 "Vendor not found"
  { name: "Purchase order POST vendorId", directions: "both", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.other.vendorId }), expect: 404, expectError: "Vendor not found" },
  { name: "PO line item POST catalogItemId", directions: "both", method: "POST", path: (c) => `/api/purchase-orders/${c.own.purchaseOrderId}/line-items`, body: (c) => ({ name: "Should Not Exist", catalogItemId: c.other.catalogItemId }), expect: 400, expectError: "Invalid catalog item" },
  { name: "SO/PO settings notify rule with foreign user", directions: "both", method: "PATCH", path: () => "/api/so-po-settings", body: (c) => ({ soStatusNotifyRules: { READY_TO_INVOICE: { type: "user", id: c.other.adminId } } }), expect: 400, expectError: "Invalid user" },
  { name: "SO/PO settings notify rule with foreign role", directions: "both", method: "PATCH", path: () => "/api/so-po-settings", body: (c) => ({ soStatusNotifyRules: { READY_TO_ORDER: { type: "role", id: c.other.globalAdminRoleId } } }), expect: 400, expectError: "Invalid role" },

  // ── Permission escalation inside one company ──
  { name: "Limited role grants a permission it doesn't hold", directions: "once", sameCompany: true, actor: "limited", method: "PATCH", path: (c) => `/api/roles/${c.targetRoleId}`, body: () => ({ permissions: { quotes: { delete: true } } }), expect: 403, expectError: "You can't grant permissions you don't have yourself" },
]

// ─── HARNESS ─────────────────────────────────────────────────────────────────

type Result = "PASS" | "FAIL" | "UNEXPECTED"

interface Row {
  attempt: string
  expected: string
  actual: string
  result: Result
  note?: string
}

class HarnessBroken extends Error {}

function readBaseUrl(argv: readonly string[]): string {
  let value = "http://localhost:3000"
  argv.forEach((arg, i) => {
    if (arg === "--base-url" && argv[i + 1]) value = argv[i + 1]
    else if (arg.startsWith("--base-url=")) value = arg.slice("--base-url=".length)
  })
  const url = new URL(value)
  // Only ever a server on this machine, which `next dev` points at the dev database
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new HarnessBroken(`--base-url must point at this machine (localhost), got ${url.hostname}`)
  }
  return url.origin
}

// Cookies live only in this object, never on disk
class Session {
  private cookies = new Map<string, string>()
  constructor(
    readonly label: string,
    private readonly baseUrl: string
  ) {}

  private store(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";")
      const eq = pair.indexOf("=")
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  hasSessionCookie() {
    return [...this.cookies.keys()].some((k) => k.includes("authjs.session-token"))
  }

  async request(method: Method, path: string, options: { json?: unknown; multipart?: boolean; form?: URLSearchParams } = {}) {
    const headers: Record<string, string> = { Cookie: this.cookieHeader() }
    let body: BodyInit | undefined
    if (options.multipart) {
      const form = new FormData()
      form.append("note", "no file on purpose")
      body = form
    } else if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
      body = options.form
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(options.json)
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body, redirect: "manual" })
    this.store(res)
    const text = await res.text()
    return { status: res.status, text, location: res.headers.get("location") ?? "" }
  }

  // The real Auth.js credentials flow: csrf token, then the callback
  async signIn(email: string, password: string) {
    const csrf = await this.request("GET", "/api/auth/csrf")
    const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken
    if (!csrfToken) throw new HarnessBroken(`${this.label}: no csrf token from /api/auth/csrf`)

    const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: `${this.baseUrl}/dashboard` })
    const callback = await this.request("POST", "/api/auth/callback/credentials", { form })
    const error = new URL(callback.location || "/", this.baseUrl).searchParams.get("error")
    if (error || !this.hasSessionCookie()) {
      throw new HarnessBroken(`${this.label}: sign in failed (${error ?? "no session cookie"}). Check the password variable and that the account isn't locked.`)
    }

    const session = await this.request("GET", "/api/auth/session")
    const user = (JSON.parse(session.text || "null") as { user?: { email?: string } } | null)?.user
    if (user?.email !== email) throw new HarnessBroken(`${this.label}: signed in, but /api/auth/session doesn't show ${email}`)
  }
}

// Every refusal from the app is a JSON { error }. Next's own 404 for a path
// that doesn't exist is an HTML page, which must never count as a refusal.
function isJsonError(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    return !!parsed && typeof parsed.error === "string"
  } catch {
    return false
  }
}

function errorText(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (parsed && typeof parsed.error === "string") return parsed.error
  } catch {
    // not JSON
  }
  return text.slice(0, 120)
}

// Strings that only appear in the other company's data
function markersFor(ids: SampleIds, letter: TestLetter): string[] {
  const names = Object.values(testNames(letter)).filter((v) => v.length > 6 && v !== "Sample")
  return [ids.companyId, ...names]
}

// Everything an attempt could touch, per company, compared before and after
// each attempt that isn't a GET. updatedAt makes even a no-op update show.
async function snapshot(prisma: PrismaClient, companyId: string): Promise<Record<string, string>> {
  const byId = { orderBy: { id: "asc" as const } }
  const sections = {
    company: prisma.company.findUnique({ where: { id: companyId } }),
    clients: prisma.client.findMany({
      where: { companyId },
      ...byId,
      include: { contacts: { ...byId, include: { tags: byId } }, locations: byId },
    }),
    industries: prisma.industry.findMany({ where: { companyId }, ...byId }),
    contactTags: prisma.contactTag.findMany({ where: { companyId }, ...byId }),
    vendors: prisma.vendor.findMany({
      where: { companyId },
      ...byId,
      include: { locations: byId, contacts: byId, attachments: byId },
    }),
    categories: prisma.category.findMany({ where: { companyId }, ...byId }),
    customFields: prisma.inventoryCustomField.findMany({ where: { companyId }, ...byId }),
    catalogItems: prisma.catalogItem.findMany({
      where: { companyId },
      ...byId,
      include: { _count: { select: { changeLogs: true } } },
    }),
    quotes: prisma.quote.findMany({ where: { companyId }, ...byId, include: { lineItems: byId, comments: byId } }),
    quoteTemplates: prisma.quoteTemplate.findMany({ where: { companyId }, ...byId, include: { lineItems: byId } }),
    salesOrders: prisma.salesOrder.findMany({
      where: { companyId },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    purchaseOrders: prisma.purchaseOrder.findMany({
      where: { companyId },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    inventoryAssets: prisma.inventoryAsset.findMany({
      where: { companyId },
      ...byId,
      include: {
        inventoryAssetAttachments: byId,
        customFieldValues: byId,
        _count: { select: { inventoryAssetEvents: true } },
      },
    }),
    approvalWorkflows: prisma.approvalWorkflow.findMany({ where: { companyId }, ...byId }),
    roles: prisma.role.findMany({ where: { companyId }, ...byId }),
    settings: prisma.companySettings.findUnique({ where: { companyId } }),
    users: prisma.user.findMany({ where: { companyId }, ...byId, select: { id: true, active: true, roleId: true } }),
  }
  const keys = Object.keys(sections) as (keyof typeof sections)[]
  const values = await Promise.all(keys.map((k) => sections[k]))
  return Object.fromEntries(keys.map((k, i) => [k, JSON.stringify(values[i])]))
}

function changedSections(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after).filter((k) => before[k] !== after[k])
}

// Limited role and user inside Test Company B for the escalation attempt,
// reset to the same known state every run. The password exists only in
// memory for this run.
async function ensureLimitedFixture(prisma: PrismaClient, b: SampleIds) {
  const n = testNames("B")
  const companyId = b.companyId
  const limitedPermissions = { pages: { settings: true }, settingsSections: { users: true } }

  const limitedRole = await prisma.role.findFirst({ where: { companyId, name: n.limitedRole } })
  const limited = limitedRole
    ? await prisma.role.update({ where: { id: limitedRole.id }, data: { rank: 20, permissions: limitedPermissions } })
    : await prisma.role.create({ data: { companyId, name: n.limitedRole, rank: 20, permissions: limitedPermissions } })

  const targetRole = await prisma.role.findFirst({ where: { companyId, name: n.targetRole } })
  const target = targetRole
    ? await prisma.role.update({ where: { id: targetRole.id }, data: { rank: 10, permissions: {} } })
    : await prisma.role.create({ data: { companyId, name: n.targetRole, rank: 10, permissions: {} } })

  const password = generatePassword(20)
  const hashed = await bcrypt.hash(password, BCRYPT_COST)
  const existing = await prisma.user.findUnique({ where: { email: n.limitedUserEmail } })
  if (existing && existing.companyId !== companyId) {
    throw new HarnessBroken(`${n.limitedUserEmail} belongs to a different company, refusing to change it`)
  }
  const reset = { password: hashed, active: true, mustChangePassword: false, loginFailedAttempts: 0, loginLockedUntil: null }
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name: n.limitedUserName, ...reset } })
    : await prisma.user.create({ data: { companyId, name: n.limitedUserName, email: n.limitedUserEmail, ...reset } })
  await setUserRoles(prisma, user.id, [limited.id])

  return { email: n.limitedUserEmail, password, targetRoleId: target.id, targetRoleName: n.targetRole }
}

function printTable(rows: Row[]) {
  const headers = ["Attempt", "Expected", "Actual", "Result"]
  const cells = rows.map((r) => [r.attempt, r.expected, r.actual, r.result])
  // Columns sized to their longest value, nothing is cut short
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log("")
  console.log(line(headers))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const c of cells) console.log(line(c))
  const notes = rows.filter((r) => r.note && r.result !== "PASS")
  if (notes.length > 0) {
    console.log("\nDetails:")
    for (const r of notes) console.log(`  ${r.result} ${r.attempt}: ${r.note}`)
  }
}

async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  const passwords = { B: process.env.TEST_ADMIN_B_PASSWORD, C: process.env.TEST_ADMIN_C_PASSWORD }
  const missing = (["B", "C"] as const).filter((l) => !passwords[l]).map((l) => `TEST_ADMIN_${l}_PASSWORD`)
  if (missing.length > 0) {
    throw new HarnessBroken(`Set ${missing.join(" and ")} in your shell (the passwords create-test-companies printed).`)
  }

  // Imported only after the guard passed
  const { prisma } = await import("@/lib/prisma")
  const rows: Row[] = []

  const ids: Record<TestLetter, SampleIds> = { B: await loadSampleIds(prisma, "B"), C: await loadSampleIds(prisma, "C") }
  const fixture = await ensureLimitedFixture(prisma, ids.B)

  // Sign in
  const admins: Record<TestLetter, Session> = { B: new Session("Test Admin B", baseUrl), C: new Session("Test Admin C", baseUrl) }
  await admins.B.signIn(testNames("B").adminEmail, passwords.B as string)
  await admins.C.signIn(testNames("C").adminEmail, passwords.C as string)
  const limited = new Session("Test Limited B", baseUrl)
  await limited.signIn(fixture.email, fixture.password)
  console.log(`Signed in to ${baseUrl} as Test Admin B, Test Admin C, and Test Limited B.`)

  // Positive controls: each user on their OWN records must succeed, or the
  // refusals below would prove nothing
  for (const letter of ["B", "C"] as const) {
    const own = ids[letter]
    const n = testNames(letter)
    const s = admins[letter]
    const controls: { name: string; method: Method; path: string; json?: unknown; mustContain: string }[] = [
      { name: "GET own client", method: "GET", path: `/api/clients/${own.clientId}`, mustContain: own.clientId },
      { name: "GET own vendor attachments", method: "GET", path: `/api/vendors/${own.vendorId}/attachments`, mustContain: own.vendorAttachmentId },
      { name: "GET own sales order comments", method: "GET", path: `/api/sales-orders/${own.salesOrderId}/comments`, mustContain: own.soCommentId },
      { name: "GET own purchase order comments", method: "GET", path: `/api/purchase-orders/${own.purchaseOrderId}/comments`, mustContain: own.poCommentId },
      { name: "GET own asset attachments", method: "GET", path: `/api/inventory-assets/${own.assetId}/attachments`, mustContain: own.assetAttachmentId },
      { name: "GET own catalog change log", method: "GET", path: `/api/catalog/${own.catalogItemId}/change-log`, mustContain: "[" },
      // Writes the values already stored, so nothing visible changes
      { name: "PATCH own vendor contact", method: "PATCH", path: `/api/vendors/${own.vendorId}/contacts/${own.vendorContactId}`, json: { lastName: n.vendorContactLastName }, mustContain: own.vendorContactId },
      { name: "PATCH own PO line item", method: "PATCH", path: `/api/purchase-orders/${own.purchaseOrderId}/line-items/${own.poLineId}`, json: { name: n.poLine }, mustContain: own.poLineId },
    ]
    for (const control of controls) {
      const res = await s.request(control.method, control.path, { json: control.json })
      const ok = res.status === 200 && res.text.includes(control.mustContain)
      rows.push({ attempt: `[control ${letter}] ${control.name}`, expected: "200", actual: String(res.status), result: ok ? "PASS" : "FAIL", note: ok ? undefined : errorText(res.text) })
      if (!ok) {
        printTable(rows)
        throw new HarnessBroken(`Positive control "${control.name}" failed for Test Admin ${letter}, so the harness itself is broken. No cross company attempts were run.`)
      }
    }
  }
  {
    const res = await limited.request("PATCH", `/api/roles/${fixture.targetRoleId}`, { json: { name: fixture.targetRoleName } })
    const ok = res.status === 200
    rows.push({ attempt: "[control B] Limited user edits a lower role", expected: "200", actual: String(res.status), result: ok ? "PASS" : "FAIL", note: ok ? undefined : errorText(res.text) })
    if (!ok) {
      printTable(rows)
      throw new HarnessBroken("Positive control for the limited user failed, so the escalation attempt would prove nothing.")
    }
  }

  // Cross company attempts
  let before: Record<TestLetter, Record<string, string>> = {
    B: await snapshot(prisma, ids.B.companyId),
    C: await snapshot(prisma, ids.C.companyId),
  }
  for (const attempt of ATTEMPTS) {
    const directions: [TestLetter, TestLetter][] = attempt.directions === "both" ? [["B", "C"], ["C", "B"]] : [["B", "C"]]
    for (const [ownLetter, otherLetter] of directions) {
      const ctx: AttemptContext = {
        own: ids[ownLetter],
        other: ids[otherLetter],
        ownNames: testNames(ownLetter),
        targetRoleId: fixture.targetRoleId,
      }
      const session = attempt.actor === "limited" ? limited : admins[ownLetter]
      const label = `${ownLetter}->${attempt.sameCompany ? ownLetter : otherLetter} ${attempt.name}`
      const expected = `${attempt.expect}${attempt.expectError ? ` "${attempt.expectError}"` : ""}`

      let res: { status: number; text: string }
      try {
        res = await session.request(attempt.method, attempt.path(ctx), { json: attempt.body?.(ctx), multipart: attempt.multipart })
      } catch (err) {
        rows.push({ attempt: label, expected, actual: "no response", result: "UNEXPECTED", note: err instanceof Error ? err.message : String(err) })
        continue
      }

      let changed: string[] = []
      if (attempt.method !== "GET") {
        const after = { B: await snapshot(prisma, ids.B.companyId), C: await snapshot(prisma, ids.C.companyId) }
        changed = [
          ...changedSections(before.B, after.B).map((s) => `Test Company B ${s}`),
          ...changedSections(before.C, after.C).map((s) => `Test Company C ${s}`),
        ]
        before = after
      }

      const leaked = markersFor(ids[otherLetter], otherLetter).filter((m) => res.text.includes(m))
      const message = errorText(res.text)
      const row: Row = { attempt: label, expected, actual: String(res.status), result: "PASS" }

      if (changed.length > 0) {
        row.result = "FAIL"
        row.note = `data changed: ${changed.join(", ")}`
      } else if (leaked.length > 0) {
        row.result = "FAIL"
        row.note = `response contains the other company's data (${leaked.slice(0, 3).join(", ")})`
      } else if (res.status >= 200 && res.status < 300) {
        row.result = "FAIL"
        row.note = `request succeeded: ${message}`
      } else if (res.status >= 500) {
        row.result = "FAIL"
        row.note = `server error: ${message}`
      } else if (res.status === attempt.expect) {
        if (!isJsonError(res.text)) {
          row.result = "UNEXPECTED"
          row.note = "not a JSON refusal from the app, the route path may be wrong"
        } else if (attempt.expectError && !message.includes(attempt.expectError)) {
          row.result = "UNEXPECTED"
          row.note = `refused for a different reason: ${message}`
        }
      } else if (res.status === 401 || res.status === 403) {
        row.result = "UNEXPECTED"
        row.note = `auth refusal, the harness may not be signed in: ${message}`
      } else if (res.status >= 300 && res.status < 400) {
        row.result = "UNEXPECTED"
        row.note = "redirected, the harness may not be signed in"
      } else {
        row.result = "FAIL"
        row.note = `wrong refusal: ${message}`
      }
      rows.push(row)
    }
  }

  // Deactivated user: an already signed in session must stop working
  // straight away, then the account is restored
  const c = ids.C
  try {
    await prisma.user.update({ where: { id: c.adminId }, data: { active: false } })
    const api = await admins.C.request("GET", `/api/vendors/${c.vendorId}/attachments`)
    rows.push({ attempt: "Deactivated Test Admin C calls an API route", expected: "401", actual: String(api.status), result: api.status === 401 ? "PASS" : "FAIL", note: api.status === 401 ? undefined : errorText(api.text) })

    const page = await admins.C.request("GET", "/dashboard")
    const toLogin =
      (page.status >= 300 && page.status < 400 && page.location.includes("/login")) ||
      (page.status === 200 && /NEXT_REDIRECT[^"]*\/login|url=\/login/.test(page.text))
    rows.push({ attempt: "Deactivated Test Admin C opens /dashboard", expected: "redirect to /login", actual: `${page.status}${page.location ? ` ${page.location}` : ""}`, result: toLogin ? "PASS" : "FAIL" })
  } finally {
    await prisma.user.update({ where: { id: c.adminId }, data: { active: true } })
  }
  const restored = await admins.C.request("GET", `/api/vendors/${c.vendorId}/attachments`)
  rows.push({ attempt: "Reactivated Test Admin C calls an API route", expected: "200", actual: String(restored.status), result: restored.status === 200 ? "PASS" : "UNEXPECTED" })

  printTable(rows)
  const count = (r: Result) => rows.filter((row) => row.result === r).length
  console.log(`\n${rows.length} checks: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("UNEXPECTED")} UNEXPECTED`)

  await prisma.$disconnect()
  return count("FAIL") + count("UNEXPECTED") > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(err instanceof HarnessBroken ? 2 : 1)
  })
