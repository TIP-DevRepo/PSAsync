// DEV ONLY. Creates (or tops up) two throwaway companies, "Test Company B"
// and "Test Company C", each with a Global Admin user and enough sample
// data to reach every company scoped API route, for check-cross-company.ts.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts). Run from
// the repo root:
//   npx tsx scripts/dev-only/create-test-companies.ts --yes
//
// Safe to re-run: existing records are found by their fixed sample names and
// reused, missing ones are created. Each run gives both admins a new random
// password, printed once below and never written anywhere else.

import bcrypt from "bcryptjs"
import { enforceDevGuard } from "./lib/guard"
import {
  BCRYPT_COST,
  DUMMY_FILE_URL,
  TEST_LETTERS,
  generatePassword,
  loadSampleIds,
  testNames,
  type SampleIds,
  type TestLetter,
} from "./lib/test-data"
// These three only import Prisma types, so loading them can't reach the database
import { globalAdminRoleData } from "@/lib/global-admin-role"
import { ensureEveryoneRole } from "@/lib/everyone-role"
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

  async function setUpCompany(letter: TestLetter): Promise<{ password: string; adminEmail: string; ids: SampleIds }> {
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
        data: { clientId: client.id, name: n.clientLocation, address: "1 Sample Street", city: "Sampleton", isPrimary: true },
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
          email: `sample-contact-${letter.toLowerCase()}@example.test`,
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
    async function ensurePurchaseOrder(marker: string) {
      const existing = await prisma.purchaseOrder.findFirst({ where: { companyId, internalNotes: marker } })
      if (existing) return existing
      const count = await prisma.purchaseOrder.count({ where: { companyId } })
      return prisma.purchaseOrder.create({
        data: {
          companyId,
          vendorId: vendor.id,
          userId: admin.id,
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

    return { password, adminEmail: n.adminEmail, ids: await loadSampleIds(prisma, letter) }
  }

  const results: { letter: TestLetter; password: string; adminEmail: string; ids: SampleIds }[] = []
  for (const letter of TEST_LETTERS) {
    results.push({ letter, ...(await setUpCompany(letter)) })
  }

  console.log("")
  for (const { letter, password, adminEmail, ids } of results) {
    console.log(`${testNames(letter).company}`)
    console.log(`  company id: ${ids.companyId}`)
    console.log(`  admin email: ${adminEmail}`)
    console.log(`  admin password (shown only now, not saved anywhere): ${password}`)
    console.log("  sample record ids:")
    for (const [key, value] of Object.entries(ids)) {
      if (key !== "companyId") console.log(`    ${key}: ${value}`)
    }
    console.log("")
  }
  console.log("To run the cross company check, set these in your shell (not in a file), then start the dev server:")
  for (const { letter } of results) console.log(`  TEST_ADMIN_${letter}_PASSWORD=<the Test Admin ${letter} password above>`)

  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
