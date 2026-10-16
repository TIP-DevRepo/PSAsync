// DEV ONLY. Creates (or tops up) two throwaway companies, "Test Company B"
// and "Test Company C", each with a Global Admin user and enough sample
// data to reach every company scoped API route, for check-cross-company.ts.
// Each company also gets the permission test users for check-permissions.ts:
// "Test Everyone" (only the Everyone role, which is reset to no
// permissions), "Test Rep" (only a "Rep" role with pages.quotes,
// quotes.create, and quotes.edit) with a quote of their own, and "Test
// Clerk" (only a "Clerk" role with the Clients, Vendors, Catalog, and
// Inventory pages plus clients.create and clients.edit) with a sales order
// and purchase order of their own, plus a sample mailbox row for the admin
// with placeholder tokens.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts). Run from
// the repo root:
//   npx tsx scripts/dev-only/create-test-companies.ts --yes
//
// Safe to re-run: existing records are found by their fixed sample names and
// reused, missing ones are created. Each run gives every test user a new
// random password, printed once below and never written anywhere else.

import bcrypt from "bcryptjs"
import { enforceDevGuard } from "./lib/guard"
import {
  BCRYPT_COST,
  CLERK_PERMISSIONS,
  DUMMY_FILE_URL,
  PLACEHOLDER_TOKEN,
  REP_PERMISSIONS,
  TEST_LETTERS,
  generatePassword,
  loadPermissionFixtureIds,
  loadSampleIds,
  testNames,
  type PermissionFixtureIds,
  type SampleIds,
  type TestLetter,
} from "./lib/test-data"
// These three only import Prisma types, so loading them can't reach the database
import { globalAdminRoleData } from "@/lib/global-admin-role"
import { ensureEveryoneRole, everyoneRoleData } from "@/lib/everyone-role"
import { setUserRoles } from "@/lib/user-roles"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("create-test-companies")

const pad4 = (n: number) => String(n).padStart(4, "0")

async function main() {
  // Imported only after the guard, so the shared client the app uses is
  // never even constructed for a database other than psasync_dev
  const { prisma } = await import("@/lib/prisma")
  const { generateAssetTag } = await import("@/lib/inventory/generateAssetTag")
  const { logAssetEvent } = await import("@/lib/inventory/logAssetEvent")

  // Creates the user or resets an existing one to a known state: active, a
  // new password, no forced password change, no lockouts
  async function upsertTestUser(companyId: string, name: string, email: string) {
    const password = generatePassword(20)
    const hashed = await bcrypt.hash(password, BCRYPT_COST)
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing && existing.companyId !== companyId) {
      throw new Error(`${email} already belongs to a different company, refusing to change it`)
    }
    const reset = {
      name,
      password: hashed,
      active: true,
      mustChangePassword: false,
      loginFailedAttempts: 0,
      loginLockedUntil: null,
      passwordChangeFailedAttempts: 0,
      passwordChangeLockedUntil: null,
    }
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: reset })
      : await prisma.user.create({ data: { companyId, email, ...reset } })
    return { user, password }
  }

  async function setUpCompany(letter: TestLetter): Promise<{
    password: string
    adminEmail: string
    ids: SampleIds
    everyonePassword: string
    repPassword: string
    clerkPassword: string
    fixtures: PermissionFixtureIds
  }> {
    const n = testNames(letter)
    const year = new Date().getFullYear()

    // Company, roles, and admin, the same way prisma/seed.ts sets up a company
    const company =
      (await prisma.company.findFirst({ where: { name: n.company } })) ??
      (await prisma.company.create({ data: { name: n.company } }))
    const companyId = company.id

    const globalAdminRole =
      (await prisma.role.findFirst({ where: { companyId, isGlobalAdmin: true } })) ??
      (await prisma.role.create({ data: globalAdminRoleData(companyId) }))
    await ensureEveryoneRole(prisma, companyId)

    const password = generatePassword(20)
    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)
    const existingAdmin = await prisma.user.findUnique({ where: { email: n.adminEmail } })
    if (existingAdmin && existingAdmin.companyId !== companyId) {
      throw new Error(`${n.adminEmail} already belongs to a different company, refusing to change it`)
    }
    const admin = existingAdmin
      ? await prisma.user.update({
          where: { id: existingAdmin.id },
          data: {
            name: n.adminName,
            password: hashedPassword,
            active: true,
            mustChangePassword: false,
            loginFailedAttempts: 0,
            loginLockedUntil: null,
            passwordChangeFailedAttempts: 0,
            passwordChangeLockedUntil: null,
          },
        })
      : await prisma.user.create({
          data: {
            companyId,
            name: n.adminName,
            email: n.adminEmail,
            password: hashedPassword,
            active: true,
            mustChangePassword: false,
          },
        })
    // Also keeps the legacy roleId in sync, same as the seed
    await setUserRoles(prisma, admin.id, [globalAdminRole.id])

    // Clients
    const industry =
      (await prisma.industry.findFirst({ where: { companyId, name: n.industry } })) ??
      (await prisma.industry.create({ data: { companyId, name: n.industry } }))
    const contactTag =
      (await prisma.contactTag.findFirst({ where: { companyId, name: n.contactTag } })) ??
      (await prisma.contactTag.create({ data: { companyId, name: n.contactTag } }))
    const client =
      (await prisma.client.findFirst({ where: { companyId, name: n.client } })) ??
      (await prisma.client.create({
        data: { companyId, name: n.client, prefix: n.clientPrefix, status: "ACTIVE", industryId: industry.id },
      }))
    const clientLocation =
      (await prisma.clientLocation.findFirst({ where: { clientId: client.id, name: n.clientLocation } })) ??
      (await prisma.clientLocation.create({
        data: { clientId: client.id, name: n.clientLocation, address: n.clientLocationAddress, city: n.clientLocationCity, isPrimary: true },
      }))
    const contact =
      (await prisma.contact.findFirst({
        where: { clientId: client.id, firstName: n.contactFirstName, lastName: n.contactLastName },
      })) ??
      (await prisma.contact.create({
        data: {
          clientId: client.id,
          firstName: n.contactFirstName,
          lastName: n.contactLastName,
          email: n.contactEmail,
          locationId: clientLocation.id,
          isPrimary: true,
        },
      }))
    await prisma.contactTagAssignment.upsert({
      where: { contactId_contactTagId: { contactId: contact.id, contactTagId: contactTag.id } },
      create: { contactId: contact.id, contactTagId: contactTag.id },
      update: {},
    })
    if (!client.mainBillingLocationId || !client.mainShippingLocationId) {
      await prisma.client.update({
        where: { id: client.id },
        data: { mainBillingLocationId: clientLocation.id, mainShippingLocationId: clientLocation.id },
      })
    }
    if (!clientLocation.billingContactId || !clientLocation.shippingContactId) {
      await prisma.clientLocation.update({
        where: { id: clientLocation.id },
        data: { billingContactId: contact.id, shippingContactId: contact.id },
      })
    }

    // Vendors
    const vendor =
      (await prisma.vendor.findFirst({ where: { companyId, name: n.vendor } })) ??
      (await prisma.vendor.create({ data: { companyId, name: n.vendor, isVendor: true, isManufacturer: true } }))
    const vendorLocation =
      (await prisma.vendorLocation.findFirst({ where: { vendorId: vendor.id, name: n.vendorLocation } })) ??
      (await prisma.vendorLocation.create({ data: { vendorId: vendor.id, name: n.vendorLocation, isPrimary: true } }))
    if (
      !(await prisma.vendorContact.findFirst({
        where: { vendorId: vendor.id, firstName: n.vendorContactFirstName, lastName: n.vendorContactLastName },
      }))
    ) {
      await prisma.vendorContact.create({
        data: {
          vendorId: vendor.id,
          firstName: n.vendorContactFirstName,
          lastName: n.vendorContactLastName,
          locationId: vendorLocation.id,
        },
      })
    }
    // Attachment rows only, with a dummy URL. Nothing is uploaded to S3.
    if (!(await prisma.vendorAttachment.findFirst({ where: { vendorId: vendor.id, fileName: n.vendorAttachment } }))) {
      await prisma.vendorAttachment.create({
        data: { vendorId: vendor.id, fileName: n.vendorAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: admin.id },
      })
    }

    // Catalog
    const category =
      (await prisma.category.findFirst({ where: { companyId, name: n.category } })) ??
      (await prisma.category.create({ data: { companyId, name: n.category, defaultIsSerialized: true } }))
    if (!(await prisma.inventoryCustomField.findFirst({ where: { companyId, name: n.customField } }))) {
      await prisma.inventoryCustomField.create({ data: { companyId, categoryId: category.id, name: n.customField } })
    }
    const catalogItem =
      (await prisma.catalogItem.findFirst({ where: { companyId, name: n.catalogItem } })) ??
      (await prisma.catalogItem.create({
        data: {
          companyId,
          name: n.catalogItem,
          categoryId: category.id,
          vendorId: vendor.id,
          vendorSku: `SKU-${letter}-1`,
          manufacturerId: vendor.id,
          isSerialized: true,
          msrp: 100,
          cost: 60,
        },
      }))

    // Numbering below follows the quote, sales order, and purchase order
    // POST routes: prefix from Company Settings, year, then a running count
    const settings = await prisma.companySettings.findUnique({ where: { companyId } })

    // Quotes and templates
    let quote = await prisma.quote.findFirst({ where: { companyId, title: n.quote } })
    if (!quote) {
      const count = await prisma.quote.count({ where: { companyId, version: 1 } })
      const expiryDays = settings?.quoteExpiryDays || 30
      quote = await prisma.quote.create({
        data: {
          companyId,
          clientId: client.id,
          contactId: contact.id,
          userId: admin.id,
          quoteNumber: `${settings?.quotePrefix ?? "Q"}-${year}-${pad4(count + 1)}`,
          title: n.quote,
          terms: settings?.quoteTerms ?? null,
          expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
        },
      })
    }
    if (!(await prisma.quoteLineItem.findFirst({ where: { quoteId: quote.id, name: n.quoteLine } }))) {
      await prisma.quoteLineItem.create({
        data: { quoteId: quote.id, catalogItemId: catalogItem.id, name: n.quoteLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    }
    if (!(await prisma.quoteTemplate.findFirst({ where: { companyId, name: n.template } }))) {
      await prisma.quoteTemplate.create({ data: { companyId, name: n.template } })
    }

    // Sales order
    let salesOrder = await prisma.salesOrder.findFirst({ where: { companyId, internalNotes: n.salesOrder } })
    if (!salesOrder) {
      const count = await prisma.salesOrder.count({ where: { companyId } })
      salesOrder = await prisma.salesOrder.create({
        data: {
          companyId,
          clientId: client.id,
          userId: admin.id,
          soNumber: `${settings?.soPrefix ?? "SO"}-${year}-${pad4(count + 1)}`,
          internalNotes: n.salesOrder,
        },
      })
    }
    if (!(await prisma.sOLineItem.findFirst({ where: { salesOrderId: salesOrder.id, name: n.soLine } }))) {
      await prisma.sOLineItem.create({
        data: {
          salesOrderId: salesOrder.id,
          catalogItemId: catalogItem.id,
          vendorId: vendor.id,
          name: n.soLine,
          quantity: 1,
          unitPrice: 100,
          cost: 60,
        },
      })
    }
    if (!(await prisma.sOComment.findFirst({ where: { salesOrderId: salesOrder.id, message: n.soComment } }))) {
      await prisma.sOComment.create({
        data: { salesOrderId: salesOrder.id, authorUserId: admin.id, authorName: n.adminName, message: n.soComment },
      })
    }
    if (!(await prisma.sOAttachment.findFirst({ where: { salesOrderId: salesOrder.id, fileName: n.soAttachment } }))) {
      await prisma.sOAttachment.create({
        data: { salesOrderId: salesOrder.id, fileName: n.soAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: admin.id },
      })
    }

    // Purchase orders: two, so a line item from one can be sent with the
    // other's id in the URL
    async function ensurePurchaseOrder(marker: string, userId = admin.id) {
      const existing = await prisma.purchaseOrder.findFirst({ where: { companyId, internalNotes: marker } })
      if (existing) return existing
      const count = await prisma.purchaseOrder.count({ where: { companyId } })
      return prisma.purchaseOrder.create({
        data: {
          companyId,
          vendorId: vendor.id,
          userId,
          poNumber: `${settings?.poPrefix ?? "PO"}-${year}-${pad4(count + 1)}`,
          paymentType: settings?.poDefaultPaymentType ?? "Net30",
          internalNotes: marker,
        },
      })
    }
    const purchaseOrder = await ensurePurchaseOrder(n.purchaseOrder)
    await ensurePurchaseOrder(n.purchaseOrder2)
    if (!(await prisma.pOLineItem.findFirst({ where: { purchaseOrderId: purchaseOrder.id, name: n.poLine } }))) {
      await prisma.pOLineItem.create({
        data: { purchaseOrderId: purchaseOrder.id, catalogItemId: catalogItem.id, name: n.poLine, quantity: 1, unitCost: 60 },
      })
    }
    if (!(await prisma.pOComment.findFirst({ where: { purchaseOrderId: purchaseOrder.id, message: n.poComment } }))) {
      await prisma.pOComment.create({
        data: { purchaseOrderId: purchaseOrder.id, authorUserId: admin.id, authorName: n.adminName, message: n.poComment },
      })
    }
    if (!(await prisma.pOAttachment.findFirst({ where: { purchaseOrderId: purchaseOrder.id, fileName: n.poAttachment } }))) {
      await prisma.pOAttachment.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          fileName: n.poAttachment,
          fileUrl: DUMMY_FILE_URL,
          fileSize: 1,
          uploadedByUserId: admin.id,
        },
      })
    }

    // Inventory: company owned stock, so it can be checked out
    let asset = await prisma.inventoryAsset.findFirst({ where: { companyId, serialNumber: n.assetSerial } })
    if (!asset) {
      asset = await prisma.inventoryAsset.create({
        data: {
          companyId,
          catalogItemId: catalogItem.id,
          assetTag: await generateAssetTag(companyId, client.id),
          serialNumber: n.assetSerial,
          status: "IN_STOCK",
          ownerType: "COMPANY",
        },
      })
      await logAssetEvent(asset.id, "CREATED", "Created by the dev-only test data script", admin.id)
    }
    if (!(await prisma.inventoryAssetAttachment.findFirst({ where: { assetId: asset.id, fileName: n.assetAttachment } }))) {
      await prisma.inventoryAssetAttachment.create({
        data: { assetId: asset.id, fileName: n.assetAttachment, fileUrl: DUMMY_FILE_URL, fileSize: 1, uploadedByUserId: admin.id },
      })
    }

    // A container under the sample client location, holding pooled stock of
    // an item that isn't serialized
    const container =
      (await prisma.inventoryLocation.findFirst({ where: { companyId, name: n.container } })) ??
      (await prisma.inventoryLocation.create({ data: { companyId, clientLocationId: clientLocation.id, name: n.container } }))
    const stockItem =
      (await prisma.catalogItem.findFirst({ where: { companyId, name: n.stockItem } })) ??
      (await prisma.catalogItem.create({
        data: { companyId, name: n.stockItem, categoryId: category.id, isSerialized: false, msrp: 10, cost: 4 },
      }))
    await prisma.inventoryStock.upsert({
      where: { catalogItemId_locationId: { catalogItemId: stockItem.id, locationId: container.id } },
      create: { companyId, catalogItemId: stockItem.id, locationId: container.id, quantity: 5 },
      update: {},
    })

    // Approval workflow, inactive so it never holds up a real quote
    if (!(await prisma.approvalWorkflow.findFirst({ where: { companyId, name: n.workflow } }))) {
      await prisma.approvalWorkflow.create({
        data: {
          companyId,
          name: n.workflow,
          active: false,
          triggerType: "TOTAL_THRESHOLD",
          thresholdValue: 1000000,
          requiredRoleId: globalAdminRole.id,
        },
      })
    }

    // ── Permission test users ──
    // Everyone has no permissions in a test company, so Test Everyone can do
    // nothing beyond what any signed in user can
    const everyoneRole = await ensureEveryoneRole(prisma, companyId)
    await prisma.role.update({
      where: { id: everyoneRole.id },
      data: { permissions: everyoneRoleData(companyId, everyoneRole.rank).permissions },
    })
    const everyone = await upsertTestUser(companyId, n.everyoneName, n.everyoneEmail)
    await setUserRoles(prisma, everyone.user.id, [])

    // The Rep role is reset to exactly its permissions on every run
    const existingRepRole = await prisma.role.findFirst({ where: { companyId, name: n.repRole } })
    const repRole = existingRepRole
      ? await prisma.role.update({ where: { id: existingRepRole.id }, data: { permissions: REP_PERMISSIONS } })
      : await prisma.role.create({ data: { companyId, name: n.repRole, rank: 5, permissions: REP_PERMISSIONS } })
    const rep = await upsertTestUser(companyId, n.repName, n.repEmail)
    await setUserRoles(prisma, rep.user.id, [repRole.id])

    // A quote the Rep owns, next to the admin's sample quote they don't
    let repQuote = await prisma.quote.findFirst({ where: { companyId, title: n.repQuote } })
    if (!repQuote) {
      const count = await prisma.quote.count({ where: { companyId, version: 1 } })
      const expiryDays = settings?.quoteExpiryDays || 30
      repQuote = await prisma.quote.create({
        data: {
          companyId,
          clientId: client.id,
          contactId: contact.id,
          userId: rep.user.id,
          quoteNumber: `${settings?.quotePrefix ?? "Q"}-${year}-${pad4(count + 1)}`,
          title: n.repQuote,
          terms: settings?.quoteTerms ?? null,
          expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
        },
      })
    } else if (repQuote.userId !== rep.user.id || repQuote.status !== "DRAFT") {
      repQuote = await prisma.quote.update({ where: { id: repQuote.id }, data: { userId: rep.user.id, status: "DRAFT" } })
    }
    if (!(await prisma.quoteLineItem.findFirst({ where: { quoteId: repQuote.id, name: n.repQuoteLine } }))) {
      await prisma.quoteLineItem.create({
        data: { quoteId: repQuote.id, catalogItemId: catalogItem.id, name: n.repQuoteLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    }
    // The admin's sample quote stays the admin's, so the Rep has one they
    // don't own
    if (quote.userId !== admin.id || quote.status !== "DRAFT") {
      await prisma.quote.update({ where: { id: quote.id }, data: { userId: admin.id, status: "DRAFT" } })
    }

    // The Clerk role is reset to exactly its permissions on every run
    const existingClerkRole = await prisma.role.findFirst({ where: { companyId, name: n.clerkRole } })
    const clerkRole = existingClerkRole
      ? await prisma.role.update({ where: { id: existingClerkRole.id }, data: { permissions: CLERK_PERMISSIONS } })
      : await prisma.role.create({ data: { companyId, name: n.clerkRole, rank: 4, permissions: CLERK_PERMISSIONS } })
    const clerk = await upsertTestUser(companyId, n.clerkName, n.clerkEmail)
    await setUserRoles(prisma, clerk.user.id, [clerkRole.id])

    // A sales order (with a line for the sample item) and a purchase order
    // the Clerk owns, next to the admin's, for the catalog order history and
    // vendor purchase order filters
    let clerkSalesOrder = await prisma.salesOrder.findFirst({ where: { companyId, internalNotes: n.clerkSalesOrder } })
    if (!clerkSalesOrder) {
      const count = await prisma.salesOrder.count({ where: { companyId } })
      clerkSalesOrder = await prisma.salesOrder.create({
        data: {
          companyId,
          clientId: client.id,
          userId: clerk.user.id,
          soNumber: `${settings?.soPrefix ?? "SO"}-${year}-${pad4(count + 1)}`,
          internalNotes: n.clerkSalesOrder,
        },
      })
    } else if (clerkSalesOrder.userId !== clerk.user.id) {
      clerkSalesOrder = await prisma.salesOrder.update({ where: { id: clerkSalesOrder.id }, data: { userId: clerk.user.id } })
    }
    if (!(await prisma.sOLineItem.findFirst({ where: { salesOrderId: clerkSalesOrder.id, name: n.clerkSoLine } }))) {
      await prisma.sOLineItem.create({
        data: { salesOrderId: clerkSalesOrder.id, catalogItemId: catalogItem.id, name: n.clerkSoLine, quantity: 1, unitPrice: 100, cost: 60 },
      })
    }
    const clerkPurchaseOrder = await ensurePurchaseOrder(n.clerkPurchaseOrder, clerk.user.id)
    if (clerkPurchaseOrder.userId !== clerk.user.id) {
      await prisma.purchaseOrder.update({ where: { id: clerkPurchaseOrder.id }, data: { userId: clerk.user.id } })
    }
    // The admin's sample orders stay the admin's, so the Clerk has ones they don't own
    await prisma.salesOrder.updateMany({ where: { companyId, internalNotes: n.salesOrder }, data: { userId: admin.id } })
    await prisma.purchaseOrder.updateMany({ where: { companyId, internalNotes: n.purchaseOrder }, data: { userId: admin.id } })

    // The admin's mailbox row. Placeholder tokens only, and the test
    // companies have no Microsoft credentials, so it can never send.
    await prisma.microsoftConnection.upsert({
      where: { companyId_email: { companyId, email: n.adminMailboxEmail } },
      update: { label: n.adminMailboxLabel, connectedByUserId: admin.id, accessToken: PLACEHOLDER_TOKEN, refreshToken: PLACEHOLDER_TOKEN },
      create: {
        companyId,
        email: n.adminMailboxEmail,
        label: n.adminMailboxLabel,
        connectedByUserId: admin.id,
        accessToken: PLACEHOLDER_TOKEN,
        refreshToken: PLACEHOLDER_TOKEN,
      },
    })

    return {
      password,
      adminEmail: n.adminEmail,
      ids: await loadSampleIds(prisma, letter),
      everyonePassword: everyone.password,
      repPassword: rep.password,
      clerkPassword: clerk.password,
      fixtures: await loadPermissionFixtureIds(prisma, letter),
    }
  }

  const results: ({ letter: TestLetter } & Awaited<ReturnType<typeof setUpCompany>>)[] = []
  for (const letter of TEST_LETTERS) {
    results.push({ letter, ...(await setUpCompany(letter)) })
  }

  console.log("")
  for (const { letter, password, adminEmail, ids, everyonePassword, repPassword, clerkPassword, fixtures } of results) {
    const n = testNames(letter)
    console.log(`${n.company}`)
    console.log(`  company id: ${ids.companyId}`)
    console.log(`  admin email: ${adminEmail}`)
    console.log(`  admin password (shown only now, not saved anywhere): ${password}`)
    console.log(`  everyone email: ${n.everyoneEmail}`)
    console.log(`  everyone password (shown only now, not saved anywhere): ${everyonePassword}`)
    console.log(`  rep email: ${n.repEmail}`)
    console.log(`  rep password (shown only now, not saved anywhere): ${repPassword}`)
    console.log(`  clerk email: ${n.clerkEmail}`)
    console.log(`  clerk password (shown only now, not saved anywhere): ${clerkPassword}`)
    console.log("  sample record ids:")
    for (const [key, value] of Object.entries({ ...ids, ...fixtures })) {
      if (key !== "companyId") console.log(`    ${key}: ${value}`)
    }
    console.log("")
  }
  console.log("To run the cross company check, set these in your shell (not in a file), then start the dev server:")
  for (const { letter } of results) console.log(`  TEST_ADMIN_${letter}_PASSWORD=<the Test Admin ${letter} password above>`)
  console.log("The permission check also needs:")
  console.log("  TEST_EVERYONE_B_PASSWORD=<the Test Everyone B password above>")
  console.log("  TEST_REP_B_PASSWORD=<the Test Rep B password above>")
  console.log("  TEST_CLERK_B_PASSWORD=<the Test Clerk B password above>")

  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
