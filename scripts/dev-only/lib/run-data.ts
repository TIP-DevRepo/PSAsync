// Temporary data for the dev-only checks. Each run makes its own two test
// companies (B and C) with every user, role, and record the checks need,
// runs the checks, and deletes all of it again. Nothing persists between
// runs and nobody ever sees or types a test password.
//
//   marker       every company name, user email, and record name starts
//                with this run's marker, zz-check-<10 hex characters>, so
//                it can never be confused with real data
//   passwords    random (Node crypto), held only in RunCredentials, never
//                printed, logged, or returned. Users never have to change
//                them on first sign in.
//   created      the id of every row the setup makes is recorded
//   teardown     deletes this run's companies and everything in them, in
//                foreign key order inside one transaction, only after
//                confirming every recorded company and user carries this
//                run's marker. Runs in a finally block and on Ctrl+C
//                (SIGINT) and SIGTERM.
//   sweep        before setting anything up, deletes leftovers of earlier
//                runs that crashed (companies named with the zz-check-
//                marker) and says how many it removed
//
// The app's own routes add rows to these companies while the checks run
// (copies, notifications, a default dashboard). They can only exist inside
// a company this run created, so deleting the company's rows removes them
// too. Rows in any other company are never touched.
//
// Database access goes through the client the caller passes in, which the
// scripts import only after enforceDevGuard has passed.

import { randomBytes } from "crypto"
import { basename } from "path"
import bcrypt from "bcryptjs"
import type { Prisma, PrismaClient } from "@/generated/prisma"
import type { AttachmentKind } from "@/lib/attachment-paths"
// These only import Prisma types, so loading them can't reach the database
import { globalAdminRoleData } from "@/lib/global-admin-role"
import { ensureEveryoneRole } from "@/lib/everyone-role"
import { setUserRoles } from "@/lib/user-roles"
import { HarnessBroken } from "./harness"
import {
  BCRYPT_COST,
  CLERK_PERMISSIONS,
  DUMMY_FILE_URL,
  OPP_REP_PERMISSIONS,
  OPP_SETTINGS_PERMISSIONS,
  OPP_VIEWER_PERMISSIONS,
  ORDERS_PERMISSIONS,
  PLACEHOLDER_TOKEN,
  REP_PERMISSIONS,
  SAMPLE_ITEM_COST,
  TEAM_BASIC_PERMISSIONS,
  TEAM_GRANT_PERMISSIONS,
  TEAM_GRANT_RANK,
  TEAM_HIGH_PERMISSIONS,
  TEAM_HIGH_RANK,
  TEAM_LITE_PERMISSIONS,
  TEAM_LITE_RANK,
  TEAM_MANAGER_PERMISSIONS,
  TEAM_MANAGER_RANK,
  TEAM_VIEWER_PERMISSIONS,
  TEMPLATER_PERMISSIONS,
  TICKET_BASIC_PERMISSIONS,
  TICKET_DISPATCHER_PERMISSIONS,
  TICKET_SETTINGS_PERMISSIONS,
  TICKET_VIEWER_PERMISSIONS,
  TEST_LETTERS,
  generatePassword,
  testNames,
  type PermissionFixtureIds,
  type SampleIds,
  type TestLetter,
  type TestNames,
} from "./test-data"

// ─── Marker ──────────────────────────────────────────────────────────────────

export const RUN_MARKER_PREFIX = "zz-check-"
const ANY_MARKER = /^zz-check-[0-9a-f]{10}[ -]/

export function newRunMarker(): string {
  return `${RUN_MARKER_PREFIX}${randomBytes(5).toString("hex")}`
}

// Names start "<marker> " and emails "<marker>-", so one run's marker can
// never match the start of another's
export function carriesMarker(value: string | null | undefined, marker: string): boolean {
  return !!value && (value.startsWith(`${marker} `) || value.startsWith(`${marker}-`))
}

export function carriesAnyMarker(value: string | null | undefined): boolean {
  return !!value && ANY_MARKER.test(value)
}

// ─── Credentials ─────────────────────────────────────────────────────────────

// Anything that signs in through the real credentials flow: lib/harness.ts's
// Session, or the copy check-cross-company.ts keeps
export interface SignInSession {
  readonly label: string
  signIn(email: string, password: string): Promise<void>
}

// Passwords live only in this private field. Nothing reads them back out:
// the only use is signing a Session in. Printing or serializing the object
// shows nothing.
export class RunCredentials {
  readonly #passwords = new Map<string, string>()

  add(email: string, password: string) {
    this.#passwords.set(email, password)
  }

  async signIn(session: SignInSession, email: string) {
    const password = this.#passwords.get(email)
    if (!password) throw new HarnessBroken(`${session.label}: this run made no user ${email}`)
    await session.signIn(email, password)
  }

  toJSON() {
    return "[credentials]"
  }
}

// ─── Run state ───────────────────────────────────────────────────────────────

export interface CreatedRecord {
  model: string
  id: string
}

export interface RunState {
  marker: string
  created: CreatedRecord[]
  credentials: RunCredentials
}

export interface RunCompany {
  letter: TestLetter
  names: TestNames
  ids: SampleIds
  fixtures: PermissionFixtureIds
}

export interface RunData extends RunState {
  companies: Record<TestLetter, RunCompany>
}

export function startRun(): RunState {
  return { marker: newRunMarker(), created: [], credentials: new RunCredentials() }
}

function track<T extends { id: string }>(run: RunState, model: string, row: T): T {
  run.created.push({ model, id: row.id })
  return row
}

// A user with a random password and exactly these roles, recorded for
// teardown. The email must carry the run's marker.
export async function addRunUser(
  prisma: PrismaClient,
  run: RunState,
  user: { companyId: string; name: string; email: string; roleIds: string[] }
): Promise<string> {
  if (!carriesMarker(user.email, run.marker)) throw new HarnessBroken(`${user.email} doesn't carry this run's marker`)
  const password = generatePassword()
  const created = track(
    run,
    "user",
    await prisma.user.create({
      data: {
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        password: await bcrypt.hash(password, BCRYPT_COST),
        active: true,
        mustChangePassword: false,
      },
      select: { id: true },
    })
  )
  // Also keeps the legacy roleId in sync, same as the seed
  await setUserRoles(prisma, created.id, user.roleIds)
  run.credentials.add(user.email, password)
  return created.id
}

// A role recorded for teardown. The name must carry the run's marker.
export async function addRunRole(
  prisma: PrismaClient,
  run: RunState,
  role: { companyId: string; name: string; rank: number; permissions: Prisma.InputJsonValue }
): Promise<string> {
  if (!carriesMarker(role.name, run.marker)) throw new HarnessBroken(`Role ${role.name} doesn't carry this run's marker`)
  return track(run, "role", await prisma.role.create({ data: role, select: { id: true } })).id
}

// A mailbox row with placeholder tokens, recorded for teardown. Never usable
// to send anything: the test companies have no Microsoft credentials.
export async function addRunMailbox(
  prisma: PrismaClient,
  run: RunState,
  mailbox: { companyId: string; email: string; label: string; connectedByUserId: string }
): Promise<string> {
  if (!carriesMarker(mailbox.email, run.marker)) throw new HarnessBroken(`${mailbox.email} doesn't carry this run's marker`)
  const created = await prisma.microsoftConnection.create({
    data: { ...mailbox, accessToken: PLACEHOLDER_TOKEN, refreshToken: PLACEHOLDER_TOKEN },
    select: { id: true },
  })
  return track(run, "microsoftConnection", created).id
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const pad4 = (n: number) => String(n).padStart(4, "0")
const DAY = 24 * 60 * 60 * 1000

// Creates both test companies with everything the checks read: the same
// companies, roles, users, permissions, and records the old persistent
// test data had. Records every id in run.created as it goes, so a setup
// that fails halfway is still torn down.
export async function createRunData(prisma: PrismaClient, run: RunState): Promise<RunData> {
  // Imported here so loading this file never constructs the shared client
  const { generateAssetTag } = await import("@/lib/inventory/generateAssetTag")
  const { logAssetEvent } = await import("@/lib/inventory/logAssetEvent")
  const { ensureOpportunityDefaults } = await import("@/lib/opportunity-defaults")
  const { ensureTeamDefaults } = await import("@/lib/team-defaults")
  const { ensureActionButtonDefaults } = await import("@/lib/action-buttons")
  const { takeOpportunityNumber } = await import("@/lib/opportunity-number")
  const { ensureTicketDefaults } = await import("@/lib/ticket-defaults")
  const { takeRecordNumber } = await import("@/lib/record-number")
  const { bucketBaseUrl } = await import("@/lib/uploads")
  const year = new Date().getFullYear()

  async function setUpCompany(letter: TestLetter): Promise<RunCompany> {
    const n = testNames(letter, run.marker)
    const rec = <T extends { id: string }>(model: string, row: T) => track(run, model, row)
    let quoteCount = 0
    let soCount = 0
    let poCount = 0
    const quoteNumber = () => `Q-${year}-${pad4(++quoteCount)}`
    const soNumber = () => `SO-${year}-${pad4(++soCount)}`
    const poNumber = () => `PO-${year}-${pad4(++poCount)}`
    const expiresAt = () => new Date(Date.now() + 30 * DAY)

    // Company, roles, and admin, the same way prisma/seed.ts sets up a company
    const company = rec("company", await prisma.company.create({ data: { name: n.company }, select: { id: true } }))
    const companyId = company.id
    const globalAdminRole = rec("role", await prisma.role.create({ data: globalAdminRoleData(companyId), select: { id: true } }))
    // A new company's Everyone role has no permissions
    const everyoneRole = rec("role", await ensureEveryoneRole(prisma, companyId))
    const adminId = await addRunUser(prisma, run, { companyId, name: n.adminName, email: n.adminEmail, roleIds: [globalAdminRole.id] })

    // Clients
    const industry = rec("industry", await prisma.industry.create({ data: { companyId, name: n.industry } }))
    const contactTag = rec("contactTag", await prisma.contactTag.create({ data: { companyId, name: n.contactTag } }))
    const client = rec(
      "client",
      await prisma.client.create({ data: { companyId, name: n.client, prefix: n.clientPrefix, status: "ACTIVE", industryId: industry.id } })
    )
    const clientLocation = rec(
      "clientLocation",
      await prisma.clientLocation.create({
        data: { clientId: client.id, name: n.clientLocation, address: n.clientLocationAddress, city: n.clientLocationCity, isPrimary: true },
      })
    )
    // A second location, not primary, for the opportunity location checks
    const clientLocation2 = rec(
      "clientLocation",
      await prisma.clientLocation.create({ data: { clientId: client.id, name: n.clientLocation2, address: "9 Second Street", city: n.clientLocationCity } })
    )
    const contact = rec(
      "contact",
      await prisma.contact.create({
        data: {
          clientId: client.id,
          firstName: n.contactFirstName,
          lastName: n.contactLastName,
          email: n.contactEmail,
          mobile: n.contactMobile,
          locationId: clientLocation.id,
          isPrimary: true,
        },
      })
    )
    await prisma.contactTagAssignment.create({ data: { contactId: contact.id, contactTagId: contactTag.id } })
    await prisma.client.update({
      where: { id: client.id },
      data: { mainBillingLocationId: clientLocation.id, mainShippingLocationId: clientLocation.id },
    })
    await prisma.clientLocation.update({
      where: { id: clientLocation.id },
      data: { billingContactId: contact.id, shippingContactId: contact.id },
    })

    // Vendors
    const vendor = rec("vendor", await prisma.vendor.create({ data: { companyId, name: n.vendor, isVendor: true, isManufacturer: true } }))
    const vendorLocation = rec(
      "vendorLocation",
      await prisma.vendorLocation.create({ data: { vendorId: vendor.id, name: n.vendorLocation, isPrimary: true } })
    )
    const vendorContact = rec(
      "vendorContact",
      await prisma.vendorContact.create({
        data: { vendorId: vendor.id, firstName: n.vendorContactFirstName, lastName: n.vendorContactLastName, locationId: vendorLocation.id },
      })
    )
    // Attachment rows only, with a dummy URL. Nothing is uploaded to S3.
    const vendorAttachment = rec(
      "vendorAttachment",
      await prisma.vendorAttachment.create({
        data: { vendorId: vendor.id, fileName: n.vendorAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
      })
    )

    // Catalog, with a known non-zero cost for the line item cost checks
    const category = rec("category", await prisma.category.create({ data: { companyId, name: n.category, defaultIsSerialized: true } }))
    const customField = rec(
      "inventoryCustomField",
      await prisma.inventoryCustomField.create({ data: { companyId, categoryId: category.id, name: n.customField } })
    )
    const catalogItem = rec(
      "catalogItem",
      await prisma.catalogItem.create({
        data: {
          companyId,
          name: n.catalogItem,
          categoryId: category.id,
          vendorId: vendor.id,
          vendorSku: `SKU-${letter}-1`,
          manufacturerId: vendor.id,
          isSerialized: true,
          msrp: 100,
          cost: SAMPLE_ITEM_COST,
        },
      })
    )

    // Quotes and templates
    const quote = rec(
      "quote",
      await prisma.quote.create({
        data: {
          companyId,
          clientId: client.id,
          contactId: contact.id,
          userId: adminId,
          quoteNumber: quoteNumber(),
          title: n.quote,
          terms: null,
          expiresAt: expiresAt(),
        },
      })
    )
    const quoteLine = rec(
      "quoteLineItem",
      await prisma.quoteLineItem.create({
        data: { quoteId: quote.id, catalogItemId: catalogItem.id, name: n.quoteLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    )
    const template = rec("quoteTemplate", await prisma.quoteTemplate.create({ data: { companyId, name: n.template } }))

    // Sales order
    const salesOrder = rec(
      "salesOrder",
      await prisma.salesOrder.create({
        data: { companyId, clientId: client.id, userId: adminId, soNumber: soNumber(), internalNotes: n.salesOrder },
      })
    )
    const soLine = rec(
      "sOLineItem",
      await prisma.sOLineItem.create({
        data: { salesOrderId: salesOrder.id, catalogItemId: catalogItem.id, vendorId: vendor.id, name: n.soLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    )
    const soComment = rec(
      "sOComment",
      await prisma.sOComment.create({
        data: { salesOrderId: salesOrder.id, authorUserId: adminId, authorName: n.adminName, message: n.soComment },
      })
    )
    const soAttachment = rec(
      "sOAttachment",
      await prisma.sOAttachment.create({
        data: { salesOrderId: salesOrder.id, fileName: n.soAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
      })
    )

    // Purchase orders: two, so a line item from one can be sent with the
    // other's id in the URL
    const createPurchaseOrder = async (marker: string, userId: string) =>
      rec(
        "purchaseOrder",
        await prisma.purchaseOrder.create({
          data: { companyId, vendorId: vendor.id, userId, poNumber: poNumber(), paymentType: "Net30", internalNotes: marker },
        })
      )
    const purchaseOrder = await createPurchaseOrder(n.purchaseOrder, adminId)
    const purchaseOrder2 = await createPurchaseOrder(n.purchaseOrder2, adminId)
    const poLine = rec(
      "pOLineItem",
      await prisma.pOLineItem.create({
        data: { purchaseOrderId: purchaseOrder.id, catalogItemId: catalogItem.id, name: n.poLine, quantity: 1, unitCost: 60 },
      })
    )
    const poComment = rec(
      "pOComment",
      await prisma.pOComment.create({
        data: { purchaseOrderId: purchaseOrder.id, authorUserId: adminId, authorName: n.adminName, message: n.poComment },
      })
    )
    const poAttachment = rec(
      "pOAttachment",
      await prisma.pOAttachment.create({
        data: { purchaseOrderId: purchaseOrder.id, fileName: n.poAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
      })
    )

    // Inventory: company owned stock, so it can be checked out
    const asset = rec(
      "inventoryAsset",
      await prisma.inventoryAsset.create({
        data: {
          companyId,
          catalogItemId: catalogItem.id,
          assetTag: await generateAssetTag(companyId, client.id),
          serialNumber: n.assetSerial,
          status: "IN_STOCK",
          ownerType: "COMPANY",
        },
      })
    )
    await logAssetEvent(asset.id, "CREATED", "Created by the dev-only checks", adminId)
    const assetAttachment = rec(
      "inventoryAssetAttachment",
      await prisma.inventoryAssetAttachment.create({
        data: { assetId: asset.id, fileName: n.assetAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
      })
    )

    // A container under the sample client location, holding pooled stock of
    // an item that isn't serialized
    const container = rec(
      "inventoryLocation",
      await prisma.inventoryLocation.create({ data: { companyId, clientLocationId: clientLocation.id, name: n.container } })
    )
    const stockItem = rec(
      "catalogItem",
      await prisma.catalogItem.create({ data: { companyId, name: n.stockItem, categoryId: category.id, isSerialized: false, msrp: 10, cost: 4 } })
    )
    const stock = rec(
      "inventoryStock",
      await prisma.inventoryStock.create({ data: { companyId, catalogItemId: stockItem.id, locationId: container.id, quantity: 5 } })
    )

    // Approval workflow, inactive so it never holds up a quote until a
    // check switches it on
    const workflow = rec(
      "approvalWorkflow",
      await prisma.approvalWorkflow.create({
        data: { companyId, name: n.workflow, active: false, triggerType: "TOTAL_THRESHOLD", thresholdValue: 1000000, requiredRoleId: globalAdminRole.id },
      })
    )

    // ── Permission test users ──
    // Everyone holds no role at all, so Test Everyone has only the Everyone
    // role, which has no permissions
    const everyoneUserId = await addRunUser(prisma, run, { companyId, name: n.everyoneName, email: n.everyoneEmail, roleIds: [] })

    const repRoleId = await addRunRole(prisma, run, { companyId, name: n.repRole, rank: 5, permissions: REP_PERMISSIONS })
    // A second role for opportunities, ranked below Rep so Test Rep's rank stays 5
    const oppRepRoleId = await addRunRole(prisma, run, { companyId, name: n.oppRepRole, rank: 1, permissions: OPP_REP_PERMISSIONS })
    const repUserId = await addRunUser(prisma, run, { companyId, name: n.repName, email: n.repEmail, roleIds: [repRoleId, oppRepRoleId] })

    // A quote the Rep owns, next to the admin's sample quote they don't
    const repQuote = rec(
      "quote",
      await prisma.quote.create({
        data: {
          companyId,
          clientId: client.id,
          contactId: contact.id,
          userId: repUserId,
          quoteNumber: quoteNumber(),
          title: n.repQuote,
          terms: null,
          expiresAt: expiresAt(),
        },
      })
    )
    const repQuoteLine = rec(
      "quoteLineItem",
      await prisma.quoteLineItem.create({
        data: { quoteId: repQuote.id, catalogItemId: catalogItem.id, name: n.repQuoteLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    )

    // ── Quote copy fixtures ──
    // A second client with its own contact, payment terms, and shipping
    // location, for copying a quote to a different client
    const copyClient = rec(
      "client",
      await prisma.client.create({ data: { companyId, name: n.copyClient, status: "ACTIVE", paymentTerms: n.copyClientPaymentTerms } })
    )
    const copyLocation = rec(
      "clientLocation",
      await prisma.clientLocation.create({
        data: { clientId: copyClient.id, name: n.copyClientLocation, address: "2 Copy Street", city: "Copyton", isPrimary: true },
      })
    )
    await prisma.client.update({
      where: { id: copyClient.id },
      data: { mainShippingLocationId: copyLocation.id, mainBillingLocationId: copyLocation.id },
    })
    const copyLocation2 = rec(
      "clientLocation",
      await prisma.clientLocation.create({ data: { clientId: copyClient.id, name: n.copyClientLocation2, address: "4 Copy Lane", city: "Copyton" } })
    )
    const copyContact = rec(
      "contact",
      await prisma.contact.create({
        data: { clientId: copyClient.id, firstName: n.copyContactFirstName, lastName: n.copyContactLastName, locationId: copyLocation.id },
      })
    )
    // An admin quote on the sample client with every kind of line, a PO
    // number, and internal notes the copy must leave behind
    const copyQuote = rec(
      "quote",
      await prisma.quote.create({
        data: {
          companyId,
          clientId: client.id,
          contactId: contact.id,
          userId: adminId,
          quoteNumber: quoteNumber(),
          title: n.copyQuote,
          terms: null,
          expiresAt: expiresAt(),
          sections: ["Hardware", "Empty section", "Services"],
          clientPoNumber: "DEV-PO-1",
          internalNotes: "Dev only internal note",
        },
      })
    )
    const copyLines = [
      { section: "Hardware", sortOrder: 0, name: `${n.copyLinePrefix} switch`, catalogItemId: catalogItem.id, quantity: 2, unitPrice: 100, cost: 60, discount: 10, taxable: false },
      { section: "Hardware", sortOrder: 1, name: `${n.copyLinePrefix} bundle`, bundleName: "Dev Bundle", isBundleHeader: true, bundleDisplayMode: "EXPANDED", unitPrice: 500, cost: 300 },
      { section: "Hardware", sortOrder: 0, name: `${n.copyLinePrefix} bundle child one`, bundleName: "Dev Bundle", unitPrice: 0, cost: 250 },
      { section: "Hardware", sortOrder: 1, name: `${n.copyLinePrefix} bundle child two`, bundleName: "Dev Bundle", quantity: 2, unitPrice: 0, cost: 25 },
      { section: "Hardware", sortOrder: 2, name: `${n.copyLinePrefix} text block`, isTextBlock: true, description: "Dev only text block", unitPrice: 0 },
      { section: "Services", sortOrder: 0, name: `${n.copyLinePrefix} choice one`, choiceGroup: "Dev Choice", isOptional: true, optionalSelected: false, unitPrice: 50, cost: 20 },
      { section: "Services", sortOrder: 1, name: `${n.copyLinePrefix} choice two`, choiceGroup: "Dev Choice", isOptional: true, optionalSelected: true, unitPrice: 90, cost: 40 },
      { section: "Services", sortOrder: 2, name: `${n.copyLinePrefix} optional`, isOptional: true, optionalSelected: false, unitPrice: 200, cost: 120 },
      { section: "Services", sortOrder: 3, name: `${n.copyLinePrefix} adjustable`, quantityAdjustable: true, quantity: 25, unitPrice: 12, cost: 8 },
      { section: "Services", sortOrder: 4, name: `${n.copyLinePrefix} recurring`, isRecurring: true, recurringInterval: "QUARTERLY" as const, unitPrice: 300, cost: 100, discount: 5 },
    ]
    for (const line of copyLines) {
      rec("quoteLineItem", await prisma.quoteLineItem.create({ data: { quoteId: copyQuote.id, ...line }, select: { id: true } }))
    }

    // Clerk, with a sales order (a line for the sample item) and a purchase
    // order of its own, next to the admin's, for the catalog order history
    // and vendor purchase order filters
    const clerkRoleId = await addRunRole(prisma, run, { companyId, name: n.clerkRole, rank: 4, permissions: CLERK_PERMISSIONS })
    const clerkUserId = await addRunUser(prisma, run, { companyId, name: n.clerkName, email: n.clerkEmail, roleIds: [clerkRoleId] })
    const clerkSalesOrder = rec(
      "salesOrder",
      await prisma.salesOrder.create({
        data: { companyId, clientId: client.id, userId: clerkUserId, soNumber: soNumber(), internalNotes: n.clerkSalesOrder },
      })
    )
    rec(
      "sOLineItem",
      await prisma.sOLineItem.create({
        data: { salesOrderId: clerkSalesOrder.id, catalogItemId: catalogItem.id, name: n.clerkSoLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    )
    const clerkPurchaseOrder = await createPurchaseOrder(n.clerkPurchaseOrder, clerkUserId)

    // Orders, with a draft sales order and purchase order of its own, each
    // with a line, next to the admin's. No purchase order is generated, so
    // every field stays editable.
    const ordersRoleId = await addRunRole(prisma, run, { companyId, name: n.ordersRole, rank: 3, permissions: ORDERS_PERMISSIONS })
    const ordersUserId = await addRunUser(prisma, run, { companyId, name: n.ordersName, email: n.ordersEmail, roleIds: [ordersRoleId] })
    const ordersSalesOrder = rec(
      "salesOrder",
      await prisma.salesOrder.create({
        data: { companyId, clientId: client.id, userId: ordersUserId, soNumber: soNumber(), internalNotes: n.ordersSalesOrder },
      })
    )
    const ordersSoLine = rec(
      "sOLineItem",
      await prisma.sOLineItem.create({
        data: {
          salesOrderId: ordersSalesOrder.id,
          catalogItemId: catalogItem.id,
          vendorId: vendor.id,
          name: n.ordersSoLine,
          quantity: 1,
          unitPrice: 100,
          cost: SAMPLE_ITEM_COST,
        },
      })
    )
    const ordersPurchaseOrder = await createPurchaseOrder(n.ordersPurchaseOrder, ordersUserId)
    const ordersPoLine = rec(
      "pOLineItem",
      await prisma.pOLineItem.create({
        data: { purchaseOrderId: ordersPurchaseOrder.id, catalogItemId: catalogItem.id, name: n.ordersPoLine, quantity: 1, unitCost: SAMPLE_ITEM_COST },
      })
    )

    // Templater, with a quote template holding one line for the sample
    // catalog item at the catalog cost, for the line item cost checks
    const templaterRoleId = await addRunRole(prisma, run, { companyId, name: n.templaterRole, rank: 2, permissions: TEMPLATER_PERMISSIONS })
    const templaterUserId = await addRunUser(prisma, run, { companyId, name: n.templaterName, email: n.templaterEmail, roleIds: [templaterRoleId] })
    const costTemplate = rec("quoteTemplate", await prisma.quoteTemplate.create({ data: { companyId, name: n.costTemplate } }))
    const costTemplateLine = rec(
      "quoteTemplateLineItem",
      await prisma.quoteTemplateLineItem.create({
        data: { templateId: costTemplate.id, catalogItemId: catalogItem.id, name: n.costTemplateLine, quantity: 1, unitPrice: 100, cost: SAMPLE_ITEM_COST },
      })
    )

    // ── Opportunities ──
    // The default stages, types, and settings, made the way the app makes
    // them on first use, and recorded for teardown
    await ensureOpportunityDefaults(companyId)
    const opportunityStages = await prisma.opportunityStage.findMany({
      where: { companyId },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    for (const stage of opportunityStages) rec("opportunityStage", stage)
    const opportunityStageNames = (
      await prisma.opportunityStage.findMany({ where: { companyId }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    ).map((s) => s.name)
    const opportunityTypes = await prisma.opportunityType.findMany({
      where: { companyId },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    for (const type of opportunityTypes) rec("opportunityType", type)
    rec("opportunitySettings", await prisma.opportunitySettings.findUniqueOrThrow({ where: { companyId }, select: { id: true } }))
    const oppViewerRoleId = await addRunRole(prisma, run, { companyId, name: n.oppViewerRole, rank: 1, permissions: OPP_VIEWER_PERMISSIONS })
    const oppViewerUserId = await addRunUser(prisma, run, { companyId, name: n.oppViewerName, email: n.oppViewerEmail, roleIds: [oppViewerRoleId] })
    const oppSettingsRoleId = await addRunRole(prisma, run, { companyId, name: n.oppSettingsRole, rank: 1, permissions: OPP_SETTINGS_PERMISSIONS })
    const oppSettingsUserId = await addRunUser(prisma, run, { companyId, name: n.oppSettingsName, email: n.oppSettingsEmail, roleIds: [oppSettingsRoleId] })

    // ── Teams ──
    // General, made the way the app makes it on first use, holds Test Rep
    // and Test Opp Viewer, so they still see the unassigned sample
    // opportunity. Sales and Support are made here (see testNames).
    await ensureTeamDefaults(companyId, prisma)
    const generalTeam = rec("team", await prisma.team.findFirstOrThrow({ where: { companyId, isDefault: true }, select: { id: true } }))
    const teamGrantRoleId = await addRunRole(prisma, run, { companyId, name: n.teamGrantRole, rank: TEAM_GRANT_RANK, permissions: TEAM_GRANT_PERMISSIONS })
    const teamHighRoleId = await addRunRole(prisma, run, { companyId, name: n.teamHighRole, rank: TEAM_HIGH_RANK, permissions: TEAM_HIGH_PERMISSIONS })
    const teamLiteRoleId = await addRunRole(prisma, run, { companyId, name: n.teamLiteRole, rank: TEAM_LITE_RANK, permissions: TEAM_LITE_PERMISSIONS })
    const teamBasicRoleId = await addRunRole(prisma, run, { companyId, name: n.teamBasicRole, rank: 1, permissions: TEAM_BASIC_PERMISSIONS })
    const teamViewerRoleId = await addRunRole(prisma, run, { companyId, name: n.teamViewerRole, rank: 1, permissions: TEAM_VIEWER_PERMISSIONS })
    const teamManagerRoleId = await addRunRole(prisma, run, { companyId, name: n.teamManagerRole, rank: TEAM_MANAGER_RANK, permissions: TEAM_MANAGER_PERMISSIONS })
    const teamBasicUserId = await addRunUser(prisma, run, { companyId, name: n.teamBasicName, email: n.teamBasicEmail, roleIds: [teamBasicRoleId] })
    const teamViewerUserId = await addRunUser(prisma, run, { companyId, name: n.teamViewerName, email: n.teamViewerEmail, roleIds: [teamViewerRoleId] })
    const teamManagerUserId = await addRunUser(prisma, run, { companyId, name: n.teamManagerName, email: n.teamManagerEmail, roleIds: [teamManagerRoleId] })
    const salesTeam = rec(
      "team",
      await prisma.team.create({
        data: {
          companyId,
          name: n.salesTeam,
          sortOrder: 1,
          members: { create: [{ userId: teamBasicUserId }, { userId: teamViewerUserId }] },
          defaultRoles: { create: [{ roleId: teamGrantRoleId }] },
        },
        select: { id: true },
      })
    )
    const supportTeam = rec(
      "team",
      await prisma.team.create({
        data: { companyId, name: n.supportTeam, sortOrder: 2, defaultRoles: { create: [{ roleId: teamHighRoleId }] } },
        select: { id: true },
      })
    )
    const opsTeam = rec(
      "team",
      await prisma.team.create({
        data: {
          companyId,
          name: n.opsTeam,
          sortOrder: 3,
          members: { create: [{ userId: adminId }, { userId: teamManagerUserId }] },
          defaultRoles: { create: [{ roleId: teamLiteRoleId }] },
        },
        select: { id: true },
      })
    )
    await prisma.teamMember.createMany({ data: [{ teamId: generalTeam.id, userId: repUserId }, { teamId: generalTeam.id, userId: oppViewerUserId }] })

    // Numbered by the app's own counter, so an opportunity a check creates
    // takes the next number
    const createOpportunity = async (title: string, ownerId: string | null, who: string, teamId = generalTeam.id) => {
      const opportunity = rec(
        "opportunity",
        await prisma.$transaction(async (tx) =>
          tx.opportunity.create({
            data: {
              companyId,
              number: await takeOpportunityNumber(tx, companyId),
              title,
              clientId: client.id,
              contactId: contact.id,
              // The client's main location, as a create without one saves
              clientLocationId: clientLocation.id,
              ownerId,
              teamId,
              stageId: opportunityStages[0].id,
              typeId: opportunityTypes[0].id,
              createdById: adminId,
            },
            select: { id: true, number: true },
          })
        )
      )
      // Attachment rows only, with a dummy URL. Nothing is uploaded to S3.
      const attachment = rec(
        "opportunityAttachment",
        await prisma.opportunityAttachment.create({
          data: { opportunityId: opportunity.id, fileName: `${n.opportunityAttachmentPrefix}-${who}.txt`, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
          select: { id: true },
        })
      )
      // Its timeline: the created action (by the admin), a stage change
      // action, a note by the admin, and a note by Test Rep, in that order.
      // Written directly, the way the app writes them.
      const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
      const stageRef = (i: number) => ({ id: opportunityStages[i].id, name: opportunityStageNames[i] })
      const entry = (data: Omit<Prisma.TimelineEntryUncheckedCreateInput, "companyId" | "opportunityId">) =>
        prisma.timelineEntry.create({ data: { companyId, opportunityId: opportunity.id, ...data }, select: { id: true } })
      const createdAction = rec(
        "timelineEntry",
        await entry({ kind: "ACTION", authorId: adminId, action: "created", data: { label: "Opportunity", number: opportunity.number, title, stage: stageRef(1) }, createdAt: at(40) })
      )
      rec("timelineEntry", await entry({ kind: "ACTION", authorId: adminId, action: "stage_changed", data: { from: stageRef(1), to: stageRef(0) }, createdAt: at(30) }))
      const adminNote = rec("timelineEntry", await entry({ kind: "NOTE", authorId: adminId, body: `<p>${n.timelineNotePrefix} by the admin</p>`, createdAt: at(20) }))
      const repNote = rec("timelineEntry", await entry({ kind: "NOTE", authorId: repUserId, body: `<p>${n.timelineNotePrefix} by Test Rep</p>`, createdAt: at(10) }))
      // Its audit log: created, and the same stage change as a field_changed
      // entry, written directly the way recordAudit writes them
      const audit = (data: Omit<Prisma.AuditLogEntryUncheckedCreateInput, "companyId" | "recordType" | "recordId" | "recordLabel" | "actorId" | "actorName">) =>
        prisma.auditLogEntry.create({
          data: { companyId, recordType: "OPPORTUNITY", recordId: opportunity.id, recordLabel: `${opportunity.number} ${title}`, actorId: adminId, actorName: n.adminName, ...data },
          select: { id: true },
        })
      rec("auditLogEntry", await audit({ action: "created", after: { number: opportunity.number, title, stage: stageRef(1) }, createdAt: at(40) }))
      const stageAudit = rec("auditLogEntry", await audit({ action: "field_changed", field: "stageId", before: stageRef(1), after: stageRef(0), createdAt: at(30) }))
      return { id: opportunity.id, attachmentId: attachment.id, actionId: createdAction.id, adminNoteId: adminNote.id, repNoteId: repNote.id, auditEntryId: stageAudit.id }
    }
    const adminOpportunity = await createOpportunity(n.adminOpportunity, adminId, "admin")
    const repOpportunity = await createOpportunity(n.repOpportunity, repUserId, "rep")
    const unassignedOpportunity = await createOpportunity(n.unassignedOpportunity, null, "unassigned")
    const salesViewerOpportunity = await createOpportunity(n.salesViewerOpportunity, teamViewerUserId, "sales-viewer", salesTeam.id)
    const salesBasicOpportunity = await createOpportunity(n.salesBasicOpportunity, teamBasicUserId, "sales-basic", salesTeam.id)
    const salesUnassignedOpportunity = await createOpportunity(n.salesUnassignedOpportunity, null, "sales-unassigned", salesTeam.id)

    // ── Tickets ──
    // The defaults (types, priorities, statuses, settings, and the Helpdesk,
    // Alerts, and Lv2 Escalation queues), made the way the app makes them on
    // first use, and recorded for teardown. Then the ticket test users,
    // their memberships, the Round Robin team, and four sample tickets.
    await ensureTicketDefaults(companyId, prisma)
    const byOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }]
    const ticketTypes = await prisma.ticketType.findMany({ where: { companyId }, select: { id: true }, orderBy: byOrder })
    const ticketPriorities = await prisma.ticketPriority.findMany({ where: { companyId }, select: { id: true }, orderBy: byOrder })
    const ticketStatuses = await prisma.ticketStatus.findMany({ where: { companyId }, select: { id: true, name: true, category: true }, orderBy: byOrder })
    for (const row of ticketTypes) rec("ticketType", row)
    for (const row of ticketPriorities) rec("ticketPriority", row)
    for (const row of ticketStatuses) rec("ticketStatus", { id: row.id })
    rec("ticketSettings", await prisma.ticketSettings.findUniqueOrThrow({ where: { companyId }, select: { id: true } }))
    const queue = async (name: string) => rec("team", await prisma.team.findFirstOrThrow({ where: { companyId, name }, select: { id: true } }))
    const helpdeskTeam = await queue("Helpdesk")
    const alertsTeam = await queue("Alerts")
    const lv2Team = await queue("Lv2 Escalation")
    const firstStatusOf = (category: string) => {
      const found = ticketStatuses.find((s) => s.category === category)
      if (!found) throw new HarnessBroken(`The default ticket statuses have no ${category} status`)
      return found
    }
    const openStatus = firstStatusOf("OPEN")

    const ticketBasicRoleId = await addRunRole(prisma, run, { companyId, name: n.ticketBasicRole, rank: 1, permissions: TICKET_BASIC_PERMISSIONS })
    const ticketViewerRoleId = await addRunRole(prisma, run, { companyId, name: n.ticketViewerRole, rank: 1, permissions: TICKET_VIEWER_PERMISSIONS })
    const ticketDispatcherRoleId = await addRunRole(prisma, run, { companyId, name: n.ticketDispatcherRole, rank: 1, permissions: TICKET_DISPATCHER_PERMISSIONS })
    const ticketSettingsRoleId = await addRunRole(prisma, run, { companyId, name: n.ticketSettingsRole, rank: 1, permissions: TICKET_SETTINGS_PERMISSIONS })
    const ticketBasicUserId = await addRunUser(prisma, run, { companyId, name: n.ticketBasicName, email: n.ticketBasicEmail, roleIds: [ticketBasicRoleId] })
    const ticketViewerUserId = await addRunUser(prisma, run, { companyId, name: n.ticketViewerName, email: n.ticketViewerEmail, roleIds: [ticketViewerRoleId] })
    const ticketDispatcherUserId = await addRunUser(prisma, run, { companyId, name: n.ticketDispatcherName, email: n.ticketDispatcherEmail, roleIds: [ticketDispatcherRoleId] })
    const ticketSettingsUserId = await addRunUser(prisma, run, { companyId, name: n.ticketSettingsName, email: n.ticketSettingsEmail, roleIds: [ticketSettingsRoleId] })
    // Deactivated, so round robin must skip it
    const ticketInactiveUserId = await addRunUser(prisma, run, { companyId, name: n.ticketInactiveName, email: n.ticketInactiveEmail, roleIds: [ticketBasicRoleId] })
    await prisma.user.update({ where: { id: ticketInactiveUserId }, data: { active: false } })
    await prisma.teamMember.createMany({
      data: [ticketBasicUserId, ticketViewerUserId, ticketDispatcherUserId].map((userId) => ({ teamId: helpdeskTeam.id, userId })),
    })
    const lastTeam = await prisma.team.aggregate({ where: { companyId }, _max: { sortOrder: true } })
    const roundRobinTeam = rec(
      "team",
      await prisma.team.create({
        data: {
          companyId,
          name: n.roundRobinTeam,
          sortOrder: (lastTeam._max.sortOrder ?? 0) + 1,
          roundRobinEnabled: true,
          members: { create: [{ userId: ticketBasicUserId }, { userId: ticketViewerUserId }, { userId: ticketInactiveUserId }] },
        },
        select: { id: true },
      })
    )

    // Numbered by the app's own counter (key "ticket"), so a ticket a check
    // creates takes the next number
    const createTicket = async (title: string, assigneeId: string | null, who: string, teamId = helpdeskTeam.id) => {
      const ticket = rec(
        "ticket",
        await prisma.$transaction(async (tx) =>
          tx.ticket.create({
            data: {
              companyId,
              number: await takeRecordNumber(tx, companyId, "ticket", "T"),
              title,
              clientId: client.id,
              contactId: contact.id,
              clientLocationId: clientLocation.id,
              teamId,
              assigneeId,
              typeId: ticketTypes[0].id,
              priorityId: ticketPriorities[0].id,
              statusId: openStatus.id,
              createdById: adminId,
            },
            select: { id: true, number: true },
          })
        )
      )
      // Attachment rows only, with a dummy URL. Nothing is uploaded to S3.
      const attachment = rec(
        "ticketAttachment",
        await prisma.ticketAttachment.create({
          data: { ticketId: ticket.id, fileName: `${n.ticketAttachmentPrefix}-${who}.txt`, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: adminId },
          select: { id: true },
        })
      )
      // Its timeline: the created action (by the admin), a note by the
      // admin, and a note by Test Ticket Basic, written the way the app writes them
      const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
      const entry = (data: Omit<Prisma.TimelineEntryUncheckedCreateInput, "companyId" | "ticketId">) =>
        prisma.timelineEntry.create({ data: { companyId, ticketId: ticket.id, ...data }, select: { id: true } })
      rec("timelineEntry", await entry({ kind: "ACTION", authorId: adminId, action: "created", data: { label: "Ticket", number: ticket.number, title, status: { id: openStatus.id, name: openStatus.name } }, createdAt: at(40) }))
      const adminNote = rec("timelineEntry", await entry({ kind: "NOTE", authorId: adminId, body: `<p>${n.ticketNotePrefix} by the admin</p>`, createdAt: at(20) }))
      const basicNote = rec("timelineEntry", await entry({ kind: "NOTE", authorId: ticketBasicUserId, body: `<p>${n.ticketNotePrefix} by Test Ticket Basic</p>`, createdAt: at(10) }))
      // Its audit log: created, and a status change as a field_changed
      // entry (New to Open, the first two OPEN statuses)
      const audit = (data: Omit<Prisma.AuditLogEntryUncheckedCreateInput, "companyId" | "recordType" | "recordId" | "recordLabel" | "actorId" | "actorName">) =>
        prisma.auditLogEntry.create({
          data: { companyId, recordType: "TICKET", recordId: ticket.id, recordLabel: `${ticket.number} ${title}`, actorId: adminId, actorName: n.adminName, ...data },
          select: { id: true },
        })
      rec("auditLogEntry", await audit({ action: "created", after: { number: ticket.number, title }, createdAt: at(40) }))
      const statusAudit = rec(
        "auditLogEntry",
        await audit({ action: "field_changed", field: "statusId", before: { id: ticketStatuses[1].id, name: ticketStatuses[1].name }, after: { id: openStatus.id, name: openStatus.name }, createdAt: at(30) })
      )
      return { id: ticket.id, attachmentId: attachment.id, adminNoteId: adminNote.id, basicNoteId: basicNote.id, auditEntryId: statusAudit.id }
    }
    const basicTicket = await createTicket(n.basicTicket, ticketBasicUserId, "basic")
    const viewerTicket = await createTicket(n.viewerTicket, ticketViewerUserId, "viewer")
    const unassignedTicket = await createTicket(n.unassignedTicket, null, "unassigned")
    const alertsTicket = await createTicket(n.alertsTicket, null, "alerts", alertsTeam.id)
    // Every team in the company's order (General, Sales, Support, Ops, the
    // three queues, and the Round Robin team), for a reorder that changes nothing
    const allTeamIds = (await prisma.team.findMany({ where: { companyId }, select: { id: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })).map((t) => t.id)

    // ── Download fixtures ──
    // One attachment per kind whose stored link has the configured bucket's
    // URL format and a test key under its record's folder (the key's file
    // name carries the run's marker). No file is behind it: presigning a
    // download link never contacts S3, and teardown never sends these keys
    // to S3 (isCheckFileKey). The sample attachments above keep their dummy
    // example.test link, which the download routes answer as not available.
    const checkFile = (prefix: string) => ({
      fileName: `${run.marker}-download-${letter.toLowerCase()}.pdf`,
      fileUrl: `${bucketBaseUrl()}${prefix}${run.marker}-download.pdf`,
      fileSize: 1,
      uploadedByUserId: adminId,
    })
    const downloadFileIds: Record<AttachmentKind, string> = {
      vendor: rec("vendorAttachment", await prisma.vendorAttachment.create({ data: { vendorId: vendor.id, ...checkFile(`vendors/${vendor.id}/`) } })).id,
      "sales-order": rec("sOAttachment", await prisma.sOAttachment.create({ data: { salesOrderId: salesOrder.id, ...checkFile(`sales-orders/${salesOrder.id}/`) } })).id,
      "purchase-order": rec("pOAttachment", await prisma.pOAttachment.create({ data: { purchaseOrderId: purchaseOrder.id, ...checkFile(`purchase-orders/${purchaseOrder.id}/`) } })).id,
      "inventory-asset": rec("inventoryAssetAttachment", await prisma.inventoryAssetAttachment.create({ data: { assetId: asset.id, ...checkFile(`inventory-assets/${asset.id}/`) } })).id,
      opportunity: rec(
        "opportunityAttachment",
        await prisma.opportunityAttachment.create({ data: { opportunityId: adminOpportunity.id, ...checkFile(`opportunities/${adminOpportunity.id}/`) }, select: { id: true } })
      ).id,
      ticket: rec(
        "ticketAttachment",
        await prisma.ticketAttachment.create({ data: { ticketId: unassignedTicket.id, ...checkFile(`tickets/${unassignedTicket.id}/`) }, select: { id: true } })
      ).id,
    }

    // ── Action buttons ──
    // The five defaults (Note, Email, Raise Quote, Won, Lost), made the way
    // the app makes them on first use, then one custom Note button that
    // always moves to the second stage
    await ensureActionButtonDefaults(companyId, prisma)
    const defaultButtons = await prisma.actionButton.findMany({
      where: { companyId },
      select: { id: true, label: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    for (const button of defaultButtons) rec("actionButton", button)
    const defaultButtonId = (label: string) => {
      const found = defaultButtons.find((b) => b.label === label)
      if (!found) throw new HarnessBroken(`The default ${label} action button is missing`)
      return found.id
    }
    const customButton = rec(
      "actionButton",
      await prisma.actionButton.create({
        data: {
          companyId,
          label: n.customActionButton,
          icon: "flag",
          color: "#6D28D9",
          forOpportunities: true,
          forTickets: false,
          kind: "NOTE",
          stageMode: "FIXED",
          fixedStageId: opportunityStages[1].id,
          noteMode: "REQUIRED",
          sortOrder: defaultButtons.length,
        },
        select: { id: true },
      })
    )

    // The admin's mailbox row
    const adminMailboxId = await addRunMailbox(prisma, run, {
      companyId,
      email: n.adminMailboxEmail,
      label: n.adminMailboxLabel,
      connectedByUserId: adminId,
    })

    return {
      letter,
      names: n,
      ids: {
        companyId,
        adminId,
        globalAdminRoleId: globalAdminRole.id,
        everyoneRoleId: everyoneRole.id,
        industryId: industry.id,
        contactTagId: contactTag.id,
        clientId: client.id,
        clientLocationId: clientLocation.id,
        contactId: contact.id,
        vendorId: vendor.id,
        vendorLocationId: vendorLocation.id,
        vendorContactId: vendorContact.id,
        vendorAttachmentId: vendorAttachment.id,
        categoryId: category.id,
        customFieldId: customField.id,
        catalogItemId: catalogItem.id,
        quoteId: quote.id,
        quoteLineId: quoteLine.id,
        templateId: template.id,
        salesOrderId: salesOrder.id,
        soLineId: soLine.id,
        soCommentId: soComment.id,
        soAttachmentId: soAttachment.id,
        purchaseOrderId: purchaseOrder.id,
        purchaseOrder2Id: purchaseOrder2.id,
        poLineId: poLine.id,
        poCommentId: poComment.id,
        poAttachmentId: poAttachment.id,
        assetId: asset.id,
        assetAttachmentId: assetAttachment.id,
        workflowId: workflow.id,
        opportunityId: adminOpportunity.id,
        opportunityAttachmentId: adminOpportunity.attachmentId,
        opportunityStageId: opportunityStages[0].id,
        opportunityTypeId: opportunityTypes[0].id,
        timelineActionId: adminOpportunity.actionId,
        timelineNoteId: adminOpportunity.adminNoteId,
        auditEntryId: adminOpportunity.auditEntryId,
        generalTeamId: generalTeam.id,
        salesTeamId: salesTeam.id,
        teamGrantRoleId,
        actionButtonId: customButton.id,
        downloadFileIds,
        ticketId: unassignedTicket.id,
        ticketAttachmentId: unassignedTicket.attachmentId,
        ticketNoteId: unassignedTicket.adminNoteId,
        ticketAuditEntryId: unassignedTicket.auditEntryId,
        ticketTypeId: ticketTypes[0].id,
        ticketPriorityId: ticketPriorities[0].id,
        ticketStatusId: openStatus.id,
        helpdeskTeamId: helpdeskTeam.id,
      },
      fixtures: {
        everyoneUserId,
        repUserId,
        repRoleId,
        repQuoteId: repQuote.id,
        repQuoteLineId: repQuoteLine.id,
        adminMailboxId,
        clerkUserId,
        clerkRoleId,
        clerkSalesOrderId: clerkSalesOrder.id,
        clerkPurchaseOrderId: clerkPurchaseOrder.id,
        stockItemId: stockItem.id,
        containerId: container.id,
        stockId: stock.id,
        ordersUserId,
        ordersRoleId,
        ordersSalesOrderId: ordersSalesOrder.id,
        ordersSoLineId: ordersSoLine.id,
        ordersPurchaseOrderId: ordersPurchaseOrder.id,
        ordersPoLineId: ordersPoLine.id,
        templaterUserId,
        templaterRoleId,
        costTemplateId: costTemplate.id,
        costTemplateLineId: costTemplateLine.id,
        copyClientId: copyClient.id,
        copyContactId: copyContact.id,
        clientLocation2Id: clientLocation2.id,
        copyClientLocationId: copyLocation.id,
        copyClientLocation2Id: copyLocation2.id,
        copyQuoteId: copyQuote.id,
        oppRepRoleId,
        repOpportunityId: repOpportunity.id,
        repOpportunityAttachmentId: repOpportunity.attachmentId,
        unassignedOpportunityId: unassignedOpportunity.id,
        unassignedOpportunityAttachmentId: unassignedOpportunity.attachmentId,
        oppViewerUserId,
        oppSettingsUserId,
        opportunityStageIds: opportunityStages.map((stage) => stage.id),
        opportunityTypeIds: opportunityTypes.map((type) => type.id),
        unassignedActionId: unassignedOpportunity.actionId,
        unassignedAdminNoteId: unassignedOpportunity.adminNoteId,
        unassignedRepNoteId: unassignedOpportunity.repNoteId,
        teamIds: allTeamIds,
        supportTeamId: supportTeam.id,
        teamHighRoleId,
        opsTeamId: opsTeam.id,
        teamLiteRoleId,
        teamBasicUserId,
        teamViewerUserId,
        teamManagerUserId,
        salesViewerOpportunityId: salesViewerOpportunity.id,
        salesBasicOpportunityId: salesBasicOpportunity.id,
        salesUnassignedOpportunityId: salesUnassignedOpportunity.id,
        actionButtonIds: [...defaultButtons.map((b) => b.id), customButton.id],
        noteButtonId: defaultButtonId("Note"),
        emailButtonId: defaultButtonId("Email"),
        wonButtonId: defaultButtonId("Won"),
        lostButtonId: defaultButtonId("Lost"),
        customButtonStageId: opportunityStages[1].id,
        ticketBasicUserId,
        ticketViewerUserId,
        ticketDispatcherUserId,
        ticketSettingsUserId,
        ticketInactiveUserId,
        basicTicketId: basicTicket.id,
        viewerTicketId: viewerTicket.id,
        alertsTicketId: alertsTicket.id,
        ticketBasicNoteId: unassignedTicket.basicNoteId,
        alertsTeamId: alertsTeam.id,
        lv2TeamId: lv2Team.id,
        roundRobinTeamId: roundRobinTeam.id,
        ticketTypeIds: ticketTypes.map((t) => t.id),
        ticketPriorityIds: ticketPriorities.map((p) => p.id),
        ticketStatusIds: ticketStatuses.map((s) => s.id),
        ticketOpenStatusId: openStatus.id,
        ticketWaitingStatusId: firstStatusOf("WAITING").id,
        ticketResolvedStatusId: firstStatusOf("RESOLVED").id,
        ticketClosedStatusId: firstStatusOf("CLOSED").id,
      },
    }
  }

  const companies = {} as Record<TestLetter, RunCompany>
  for (const letter of TEST_LETTERS) companies[letter] = await setUpCompany(letter)
  return { ...run, companies }
}

// ─── Deleting whole companies ────────────────────────────────────────────────

type Db = PrismaClient | Prisma.TransactionClient
type Ids = { in: string[] }

// Rows that go with a company through cascades, counted for the summaries
const CASCADED_TABLES: { table: string; count: (db: Db, ids: Ids) => Promise<number> }[] = [
  { table: "QuoteLineItem", count: (db, ids) => db.quoteLineItem.count({ where: { quote: { companyId: ids } } }) },
  { table: "QuoteComment", count: (db, ids) => db.quoteComment.count({ where: { quote: { companyId: ids } } }) },
  { table: "QuoteTemplateLineItem", count: (db, ids) => db.quoteTemplateLineItem.count({ where: { template: { companyId: ids } } }) },
  { table: "SOLineItem", count: (db, ids) => db.sOLineItem.count({ where: { salesOrder: { companyId: ids } } }) },
  { table: "SOComment", count: (db, ids) => db.sOComment.count({ where: { salesOrder: { companyId: ids } } }) },
  { table: "SOAttachment", count: (db, ids) => db.sOAttachment.count({ where: { salesOrder: { companyId: ids } } }) },
  { table: "POLineItem", count: (db, ids) => db.pOLineItem.count({ where: { purchaseOrder: { companyId: ids } } }) },
  { table: "POLineItemSerial", count: (db, ids) => db.pOLineItemSerial.count({ where: { lineItem: { purchaseOrder: { companyId: ids } } } }) },
  { table: "POShipment", count: (db, ids) => db.pOShipment.count({ where: { purchaseOrder: { companyId: ids } } }) },
  { table: "POComment", count: (db, ids) => db.pOComment.count({ where: { purchaseOrder: { companyId: ids } } }) },
  { table: "POAttachment", count: (db, ids) => db.pOAttachment.count({ where: { purchaseOrder: { companyId: ids } } }) },
  { table: "OpportunityAttachment", count: (db, ids) => db.opportunityAttachment.count({ where: { opportunity: { companyId: ids } } }) },
  { table: "TicketAttachment", count: (db, ids) => db.ticketAttachment.count({ where: { ticket: { companyId: ids } } }) },
  { table: "InventoryAssetAttachment", count: (db, ids) => db.inventoryAssetAttachment.count({ where: { asset: { companyId: ids } } }) },
  { table: "InventoryAssetEvent", count: (db, ids) => db.inventoryAssetEvent.count({ where: { asset: { companyId: ids } } }) },
  { table: "InventoryCustomFieldValue", count: (db, ids) => db.inventoryCustomFieldValue.count({ where: { asset: { companyId: ids } } }) },
  { table: "InventoryStockEvent", count: (db, ids) => db.inventoryStockEvent.count({ where: { stock: { companyId: ids } } }) },
  { table: "CatalogItemChangeLog", count: (db, ids) => db.catalogItemChangeLog.count({ where: { catalogItem: { companyId: ids } } }) },
  { table: "ClientLocation", count: (db, ids) => db.clientLocation.count({ where: { client: { companyId: ids } } }) },
  { table: "ContactTagAssignment", count: (db, ids) => db.contactTagAssignment.count({ where: { contact: { client: { companyId: ids } } } }) },
  { table: "VendorLocation", count: (db, ids) => db.vendorLocation.count({ where: { vendor: { companyId: ids } } }) },
  { table: "VendorContact", count: (db, ids) => db.vendorContact.count({ where: { vendor: { companyId: ids } } }) },
  { table: "VendorAttachment", count: (db, ids) => db.vendorAttachment.count({ where: { vendor: { companyId: ids } } }) },
  { table: "DashboardWidget", count: (db, ids) => db.dashboardWidget.count({ where: { dashboard: { companyId: ids } } }) },
  { table: "UserRole", count: (db, ids) => db.userRole.count({ where: { user: { companyId: ids } } }) },
  { table: "TeamMember", count: (db, ids) => db.teamMember.count({ where: { team: { companyId: ids } } }) },
  { table: "TeamDefaultRole", count: (db, ids) => db.teamDefaultRole.count({ where: { team: { companyId: ids } } }) },
  { table: "Session", count: (db, ids) => db.session.count({ where: { user: { companyId: ids } } }) },
]

// Deleted in this order. Every required relation in the schema is
// ON DELETE RESTRICT and every optional one SET NULL, so each table goes
// after everything that requires it and before what it requires.
const DELETE_STEPS: {
  table: string
  count: (db: Db, ids: Ids) => Promise<number>
  remove: (db: Db, ids: Ids) => Promise<{ count: number }>
}[] = [
  { table: "Notification", count: (db, ids) => db.notification.count({ where: { companyId: ids } }), remove: (db, ids) => db.notification.deleteMany({ where: { companyId: ids } }) },
  // Nothing points at audit entries; their actor and undoer are SET NULL
  { table: "AuditLogEntry", count: (db, ids) => db.auditLogEntry.count({ where: { companyId: ids } }), remove: (db, ids) => db.auditLogEntry.deleteMany({ where: { companyId: ids } }) },
  { table: "Dashboard", count: (db, ids) => db.dashboard.count({ where: { companyId: ids } }), remove: (db, ids) => db.dashboard.deleteMany({ where: { companyId: ids } }) },
  { table: "QuoteApproval", count: (db, ids) => db.quoteApproval.count({ where: { quote: { companyId: ids } } }), remove: (db, ids) => db.quoteApproval.deleteMany({ where: { quote: { companyId: ids } } }) },
  { table: "PurchaseOrder", count: (db, ids) => db.purchaseOrder.count({ where: { companyId: ids } }), remove: (db, ids) => db.purchaseOrder.deleteMany({ where: { companyId: ids } }) },
  { table: "SalesOrder", count: (db, ids) => db.salesOrder.count({ where: { companyId: ids } }), remove: (db, ids) => db.salesOrder.deleteMany({ where: { companyId: ids } }) },
  { table: "Quote", count: (db, ids) => db.quote.count({ where: { companyId: ids } }), remove: (db, ids) => db.quote.deleteMany({ where: { companyId: ids } }) },
  // After the quotes and orders that link to them (their attachments
  // cascade), before the clients, contacts, users, stages, and types they
  // point at. Settings go before the stages, for the stage a sent quote
  // moves to.
  // Entries of an opportunity also go with it (cascade); this takes any
  // that belong to no opportunity
  { table: "TimelineEntry", count: (db, ids) => db.timelineEntry.count({ where: { companyId: ids } }), remove: (db, ids) => db.timelineEntry.deleteMany({ where: { companyId: ids } }) },
  { table: "Opportunity", count: (db, ids) => db.opportunity.count({ where: { companyId: ids } }), remove: (db, ids) => db.opportunity.deleteMany({ where: { companyId: ids } }) },
  // Before the teams, clients, contacts, users, types, priorities, and
  // statuses they point at (their attachments and timelines cascade).
  // Ticket settings go before the teams, for the default ticket team.
  { table: "Ticket", count: (db, ids) => db.ticket.count({ where: { companyId: ids } }), remove: (db, ids) => db.ticket.deleteMany({ where: { companyId: ids } }) },
  { table: "TicketSettings", count: (db, ids) => db.ticketSettings.count({ where: { companyId: ids } }), remove: (db, ids) => db.ticketSettings.deleteMany({ where: { companyId: ids } }) },
  // After the opportunities in them, before the users and roles their
  // members and default roles point at (both cascade with the team)
  { table: "Team", count: (db, ids) => db.team.count({ where: { companyId: ids } }), remove: (db, ids) => db.team.deleteMany({ where: { companyId: ids } }) },
  { table: "OpportunitySettings", count: (db, ids) => db.opportunitySettings.count({ where: { companyId: ids } }), remove: (db, ids) => db.opportunitySettings.deleteMany({ where: { companyId: ids } }) },
  // Before the stages and ticket statuses a button moves to
  { table: "ActionButton", count: (db, ids) => db.actionButton.count({ where: { companyId: ids } }), remove: (db, ids) => db.actionButton.deleteMany({ where: { companyId: ids } }) },
  { table: "OpportunityStage", count: (db, ids) => db.opportunityStage.count({ where: { companyId: ids } }), remove: (db, ids) => db.opportunityStage.deleteMany({ where: { companyId: ids } }) },
  { table: "OpportunityType", count: (db, ids) => db.opportunityType.count({ where: { companyId: ids } }), remove: (db, ids) => db.opportunityType.deleteMany({ where: { companyId: ids } }) },
  // After the tickets and the action buttons that point at them
  { table: "TicketStatus", count: (db, ids) => db.ticketStatus.count({ where: { companyId: ids } }), remove: (db, ids) => db.ticketStatus.deleteMany({ where: { companyId: ids } }) },
  { table: "TicketType", count: (db, ids) => db.ticketType.count({ where: { companyId: ids } }), remove: (db, ids) => db.ticketType.deleteMany({ where: { companyId: ids } }) },
  { table: "TicketPriority", count: (db, ids) => db.ticketPriority.count({ where: { companyId: ids } }), remove: (db, ids) => db.ticketPriority.deleteMany({ where: { companyId: ids } }) },
  { table: "QuoteTemplate", count: (db, ids) => db.quoteTemplate.count({ where: { companyId: ids } }), remove: (db, ids) => db.quoteTemplate.deleteMany({ where: { companyId: ids } }) },
  { table: "InventoryStock", count: (db, ids) => db.inventoryStock.count({ where: { companyId: ids } }), remove: (db, ids) => db.inventoryStock.deleteMany({ where: { companyId: ids } }) },
  { table: "InventoryAsset", count: (db, ids) => db.inventoryAsset.count({ where: { companyId: ids } }), remove: (db, ids) => db.inventoryAsset.deleteMany({ where: { companyId: ids } }) },
  { table: "ClientCustomPrice", count: (db, ids) => db.clientCustomPrice.count({ where: { client: { companyId: ids } } }), remove: (db, ids) => db.clientCustomPrice.deleteMany({ where: { client: { companyId: ids } } }) },
  { table: "ApprovalWorkflow", count: (db, ids) => db.approvalWorkflow.count({ where: { companyId: ids } }), remove: (db, ids) => db.approvalWorkflow.deleteMany({ where: { companyId: ids } }) },
  { table: "MicrosoftConnection", count: (db, ids) => db.microsoftConnection.count({ where: { companyId: ids } }), remove: (db, ids) => db.microsoftConnection.deleteMany({ where: { companyId: ids } }) },
  { table: "CatalogItem", count: (db, ids) => db.catalogItem.count({ where: { companyId: ids } }), remove: (db, ids) => db.catalogItem.deleteMany({ where: { companyId: ids } }) },
  { table: "InventoryCustomField", count: (db, ids) => db.inventoryCustomField.count({ where: { companyId: ids } }), remove: (db, ids) => db.inventoryCustomField.deleteMany({ where: { companyId: ids } }) },
  { table: "Category", count: (db, ids) => db.category.count({ where: { companyId: ids } }), remove: (db, ids) => db.category.deleteMany({ where: { companyId: ids } }) },
  { table: "InventoryLocation", count: (db, ids) => db.inventoryLocation.count({ where: { companyId: ids } }), remove: (db, ids) => db.inventoryLocation.deleteMany({ where: { companyId: ids } }) },
  { table: "Contact", count: (db, ids) => db.contact.count({ where: { client: { companyId: ids } } }), remove: (db, ids) => db.contact.deleteMany({ where: { client: { companyId: ids } } }) },
  { table: "Client", count: (db, ids) => db.client.count({ where: { companyId: ids } }), remove: (db, ids) => db.client.deleteMany({ where: { companyId: ids } }) },
  { table: "Industry", count: (db, ids) => db.industry.count({ where: { companyId: ids } }), remove: (db, ids) => db.industry.deleteMany({ where: { companyId: ids } }) },
  { table: "ContactTag", count: (db, ids) => db.contactTag.count({ where: { companyId: ids } }), remove: (db, ids) => db.contactTag.deleteMany({ where: { companyId: ids } }) },
  { table: "Vendor", count: (db, ids) => db.vendor.count({ where: { companyId: ids } }), remove: (db, ids) => db.vendor.deleteMany({ where: { companyId: ids } }) },
  { table: "DistributorIntegration", count: (db, ids) => db.distributorIntegration.count({ where: { companyId: ids } }), remove: (db, ids) => db.distributorIntegration.deleteMany({ where: { companyId: ids } }) },
  { table: "CompanySettings", count: (db, ids) => db.companySettings.count({ where: { companyId: ids } }), remove: (db, ids) => db.companySettings.deleteMany({ where: { companyId: ids } }) },
  { table: "User", count: (db, ids) => db.user.count({ where: { companyId: ids } }), remove: (db, ids) => db.user.deleteMany({ where: { companyId: ids } }) },
  { table: "Role", count: (db, ids) => db.role.count({ where: { companyId: ids } }), remove: (db, ids) => db.role.deleteMany({ where: { companyId: ids } }) },
  // The record number counters the app's create routes added during the run
  { table: "NumberSequence", count: (db, ids) => db.numberSequence.count({ where: { companyId: ids } }), remove: (db, ids) => db.numberSequence.deleteMany({ where: { companyId: ids } }) },
  { table: "Company", count: (db, ids) => db.company.count({ where: { id: ids } }), remove: (db, ids) => db.company.deleteMany({ where: { id: ids } }) },
]

export type TableCounts = Record<string, number>

// How many rows each table holds for these companies, cascaded children included
export async function countCompanyRows(db: Db, companyIds: string[]): Promise<TableCounts> {
  const ids = { in: companyIds }
  const counts: TableCounts = {}
  for (const step of [...DELETE_STEPS, ...CASCADED_TABLES]) counts[step.table] = await step.count(db, ids)
  return counts
}

export interface StoredFile {
  url: string
  prefix: string
}

// Every file link the companies' rows hold, with the key prefix the app
// stores that kind of file under (the same prefixes its delete routes use)
export async function storedFiles(db: Db, companyIds: string[]): Promise<StoredFile[]> {
  const ids = { in: companyIds }
  const [companies, vendors, vendorAttachments, soAttachments, poAttachments, assetAttachments, opportunityAttachments, ticketAttachments] = await Promise.all([
    db.company.findMany({ where: { id: ids }, select: { id: true, logoUrl: true, secondaryLogoUrl: true } }),
    db.vendor.findMany({ where: { companyId: ids }, select: { id: true, logoUrl: true } }),
    db.vendorAttachment.findMany({ where: { vendor: { companyId: ids } }, select: { vendorId: true, fileUrl: true } }),
    db.sOAttachment.findMany({ where: { salesOrder: { companyId: ids } }, select: { salesOrderId: true, fileUrl: true } }),
    db.pOAttachment.findMany({ where: { purchaseOrder: { companyId: ids } }, select: { purchaseOrderId: true, fileUrl: true } }),
    db.inventoryAssetAttachment.findMany({ where: { asset: { companyId: ids } }, select: { assetId: true, fileUrl: true } }),
    db.opportunityAttachment.findMany({ where: { opportunity: { companyId: ids } }, select: { opportunityId: true, fileUrl: true } }),
    db.ticketAttachment.findMany({ where: { ticket: { companyId: ids } }, select: { ticketId: true, fileUrl: true } }),
  ])
  const files: StoredFile[] = []
  for (const c of companies) {
    for (const url of [c.logoUrl, c.secondaryLogoUrl]) if (url) files.push({ url, prefix: `logos/${c.id}-` })
  }
  for (const v of vendors) if (v.logoUrl) files.push({ url: v.logoUrl, prefix: `vendors/${v.id}/logo/` })
  for (const a of vendorAttachments) files.push({ url: a.fileUrl, prefix: `vendors/${a.vendorId}/` })
  for (const a of soAttachments) files.push({ url: a.fileUrl, prefix: `sales-orders/${a.salesOrderId}/` })
  for (const a of poAttachments) files.push({ url: a.fileUrl, prefix: `purchase-orders/${a.purchaseOrderId}/` })
  for (const a of assetAttachments) files.push({ url: a.fileUrl, prefix: `inventory-assets/${a.assetId}/` })
  for (const a of opportunityAttachments) files.push({ url: a.fileUrl, prefix: `opportunities/${a.opportunityId}/` })
  for (const a of ticketAttachments) files.push({ url: a.fileUrl, prefix: `tickets/${a.ticketId}/` })
  return files
}

// The download fixtures' test keys: a file name that starts with a run
// marker. Real uploads are named with a random UUID, so no real file
// matches, and nothing is stored behind these keys.
export function isCheckFileKey(url: string): boolean {
  const name = url.split("/").pop() ?? ""
  return name.startsWith(RUN_MARKER_PREFIX)
}

// Removes the stored files with the app's own delete helper, best effort,
// once the rows are gone. Links outside the uploads bucket (the checks'
// dummy attachment links) and the download fixtures' test keys never
// reach S3.
export async function deleteFiles(files: StoredFile[]): Promise<{ deleted: number; failed: number; notInBucket: number; checkKeys: number }> {
  const result = { deleted: 0, failed: 0, notInBucket: 0, checkKeys: 0 }
  if (files.length === 0) return result
  const { bucketBaseUrl, deleteStoredObject } = await import("@/lib/uploads")
  const base = bucketBaseUrl()
  for (const file of files) {
    if (!file.url.startsWith(base)) {
      result.notInBucket++
      continue
    }
    if (isCheckFileKey(file.url)) {
      result.checkKeys++
      continue
    }
    const outcome = await deleteStoredObject(file.url, file.prefix)
    if (outcome.ok) result.deleted++
    else result.failed++
  }
  return result
}

// Deletes the companies and every row in them, all or nothing, then their
// stored files. Callers confirm the companies first.
export async function deleteCompanies(prisma: PrismaClient, companyIds: string[]): Promise<{ counts: TableCounts; files: Awaited<ReturnType<typeof deleteFiles>> }> {
  if (companyIds.length === 0) return { counts: {}, files: { deleted: 0, failed: 0, notInBucket: 0, checkKeys: 0 } }
  const ids = { in: companyIds }
  const files = await storedFiles(prisma, companyIds)
  const counts = await prisma.$transaction(
    async (tx) => {
      const before = await countCompanyRows(tx, companyIds)
      for (const step of DELETE_STEPS) await step.remove(tx, ids)
      return before
    },
    { timeout: 120_000, maxWait: 10_000 }
  )
  return { counts, files: await deleteFiles(files) }
}

export function describeCounts(counts: TableCounts): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table} ${n}`)
  return parts.length > 0 ? parts.join(", ") : "nothing"
}

// ─── Teardown and sweep ──────────────────────────────────────────────────────

// Deletes exactly this run's companies, and with them every row in them.
// A recorded company whose name, or recorded user whose email, doesn't
// carry this run's marker is refused, and its company is left alone.
export async function teardownRun(prisma: PrismaClient, run: RunState): Promise<{ companies: number; refused: string[]; counts: TableCounts }> {
  const companyIds = [...new Set(run.created.filter((r) => r.model === "company").map((r) => r.id))]
  const userIds = [...new Set(run.created.filter((r) => r.model === "user").map((r) => r.id))]
  const refused: string[] = []

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, companyId: true } })
  const confirmed = new Set<string>()
  for (const company of companies) {
    if (carriesMarker(company.name, run.marker)) confirmed.add(company.id)
    else refused.push(`company ${company.id} (its name doesn't carry this run's marker)`)
  }
  for (const user of users) {
    if (carriesMarker(user.email, run.marker)) continue
    refused.push(`user ${user.id} (its email doesn't carry this run's marker)`)
    confirmed.delete(user.companyId)
  }
  // A recorded user outside this run's companies is never deleted
  for (const user of users) {
    if (!companies.some((c) => c.id === user.companyId)) refused.push(`user ${user.id} (not in one of this run's companies)`)
  }

  const { counts } = await deleteCompanies(prisma, [...confirmed])
  return { companies: confirmed.size, refused, counts }
}

// Leftovers from earlier runs that crashed before their teardown: every
// company whose name carries a zz-check- marker. A marked user outside such
// a company is reported and left alone, since the rows around it aren't
// marked.
export async function sweepLeftovers(prisma: PrismaClient, keepMarker?: string): Promise<{ companies: number; users: number; strayUsers: number }> {
  const candidates = await prisma.company.findMany({ where: { name: { startsWith: RUN_MARKER_PREFIX } }, select: { id: true, name: true } })
  const companies = candidates.filter((c) => carriesAnyMarker(c.name) && !(keepMarker && carriesMarker(c.name, keepMarker)))
  const companyIds = companies.map((c) => c.id)
  const markedUsers = await prisma.user.findMany({ where: { email: { startsWith: RUN_MARKER_PREFIX } }, select: { id: true, email: true, companyId: true } })
  const strayUsers = markedUsers.filter((u) => carriesAnyMarker(u.email) && !candidates.some((c) => c.id === u.companyId))

  const { counts } = await deleteCompanies(prisma, companyIds)
  const result = { companies: companyIds.length, users: counts.User ?? 0, strayUsers: strayUsers.length }
  if (result.companies > 0) {
    console.log(`Leftover sweep: removed ${result.companies} companies and ${result.users} users left by earlier runs (${describeCounts(counts)}).`)
  } else {
    console.log("Leftover sweep: nothing left by earlier runs.")
  }
  if (strayUsers.length > 0) {
    console.log(`Leftover sweep: ${strayUsers.length} marked users are outside any marked company and were left alone: ${strayUsers.map((u) => u.id).join(", ")}`)
  }
  return result
}

// ─── Running with temporary data ─────────────────────────────────────────────

// Sweeps leftovers, sets up this run's data, runs fn, and tears the data
// down again whatever happens: a returned result, a thrown error, Ctrl+C,
// or SIGTERM. Disconnects the client at the end.
export async function withRunData<T>(scriptName: string, fn: (prisma: PrismaClient, run: RunData) => Promise<T>): Promise<T> {
  // Imported only after the caller's guard passed
  const { prisma } = await import("@/lib/prisma")
  const run = startRun()

  let teardown: Promise<void> | null = null
  const tearDown = () => {
    teardown ??= (async () => {
      try {
        const result = await teardownRun(prisma, run)
        console.log(`${scriptName}: removed this run's data, ${result.companies} companies (${describeCounts(result.counts)}).`)
        for (const reason of result.refused) console.log(`${scriptName}: refused to delete ${reason}.`)
      } catch (err) {
        console.error(`${scriptName}: could not remove this run's data (${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}). The next run's leftover sweep removes it.`)
      }
    })()
    return teardown
  }
  let interrupted = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) {
      console.log(`${scriptName}: still removing this run's data, please wait.`)
      return
    }
    interrupted = true
    console.log(`\n${scriptName}: ${signal} received, removing this run's data before exiting.`)
    void tearDown().finally(() => process.exit(signal === "SIGINT" ? 130 : 143))
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  try {
    await sweepLeftovers(prisma, run.marker)
    const data = await createRunData(prisma, run)
    console.log(`${scriptName}: set up ${run.marker} (2 companies, ${run.created.filter((r) => r.model === "user").length} users, ${run.created.length} records).`)
    return await fn(prisma, data)
  } finally {
    await tearDown()
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }
}

// True when this file is the script node was started with, so a check can
// run on its own or be imported by run-checks.ts without running twice
export function isEntryScript(name: string): boolean {
  const started = basename(process.argv[1] ?? "").replace(/\.[cm]?[jt]s$/, "")
  return started === name
}
