// Names and lookups shared by the dev-only test scripts. Every sample record
// gets a fixed, recognizable name (or marker field) per company, so the
// create script can find what already exists and top it up, and the check
// script can find the ids again without anything being copied by hand.
//
// Type-only imports here, so loading this file never touches the database.

import { randomInt } from "crypto"
import type { PrismaClient } from "@/generated/prisma"

export type TestLetter = "B" | "C"
export const TEST_LETTERS: readonly TestLetter[] = ["B", "C"]

// Same cost factor the app uses for every password it stores
export const BCRYPT_COST = 10

export function testNames(letter: TestLetter) {
  const lower = letter.toLowerCase()
  return {
    company: `Test Company ${letter}`,
    adminName: `Test Admin ${letter}`,
    adminEmail: `test-admin-${lower}@example.test`,
    industry: `Sample Industry ${letter}`,
    contactTag: `Sample Tag ${letter}`,
    client: `Sample Client ${letter}`,
    clientPrefix: `TC${letter}`,
    clientLocation: `Sample Location ${letter}`,
    contactFirstName: "Sample",
    contactLastName: `Contact ${letter}`,
    vendor: `Sample Vendor ${letter}`,
    vendorLocation: `Sample Vendor Location ${letter}`,
    vendorContactFirstName: "Sample",
    vendorContactLastName: `Vendor Contact ${letter}`,
    vendorAttachment: `sample-vendor-${lower}.txt`,
    category: `Sample Category ${letter}`,
    customField: `Sample Field ${letter}`,
    catalogItem: `Sample Item ${letter}`,
    quote: `Sample Quote ${letter}`,
    quoteLine: `Sample Quote Line ${letter}`,
    template: `Sample Template ${letter}`,
    salesOrder: `Sample Sales Order ${letter}`,
    soLine: `Sample SO Line ${letter}`,
    soComment: `Sample SO comment ${letter}`,
    soAttachment: `sample-so-${lower}.txt`,
    purchaseOrder: `Sample Purchase Order ${letter}`,
    purchaseOrder2: `Sample Purchase Order ${letter} (second)`,
    poLine: `Sample PO Line ${letter}`,
    poComment: `Sample PO comment ${letter}`,
    poAttachment: `sample-po-${lower}.txt`,
    assetSerial: `SAMPLE-${letter}-0001`,
    assetAttachment: `sample-asset-${lower}.txt`,
    workflow: `Sample Workflow ${letter}`,
    // Only created by the check script, for the role escalation attempt
    limitedRole: `Test Limited Role ${letter}`,
    targetRole: `Test Target Role ${letter}`,
    limitedUserName: `Test Limited ${letter}`,
    limitedUserEmail: `test-limited-${lower}@example.test`,
  }
}

// Letters and digits only, so it pastes into any shell without quoting
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

export function generatePassword(length = 20): string {
  let out = ""
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return out
}

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

// Finds every sample record for one test company. Throws naming whatever
// is missing, so a half set up company is never tested.
export async function loadSampleIds(prisma: PrismaClient, letter: TestLetter): Promise<SampleIds> {
  const n = testNames(letter)
  const company = await prisma.company.findFirst({ where: { name: n.company }, select: { id: true } })
  if (!company) {
    throw new Error(`${n.company} doesn't exist yet. Run create-test-companies first.`)
  }
  const companyId = company.id
  const id = (row: { id: string } | null) => row?.id ?? ""

  const [admin, globalAdminRole, everyoneRole, industry, contactTag, client, vendor, category, catalogItem] = await Promise.all([
    prisma.user.findFirst({ where: { email: n.adminEmail, companyId }, select: { id: true } }),
    prisma.role.findFirst({ where: { companyId, isGlobalAdmin: true }, select: { id: true } }),
    prisma.role.findFirst({ where: { companyId, isEveryone: true }, select: { id: true } }),
    prisma.industry.findFirst({ where: { companyId, name: n.industry }, select: { id: true } }),
    prisma.contactTag.findFirst({ where: { companyId, name: n.contactTag }, select: { id: true } }),
    prisma.client.findFirst({ where: { companyId, name: n.client }, select: { id: true } }),
    prisma.vendor.findFirst({ where: { companyId, name: n.vendor }, select: { id: true } }),
    prisma.category.findFirst({ where: { companyId, name: n.category }, select: { id: true } }),
    prisma.catalogItem.findFirst({ where: { companyId, name: n.catalogItem }, select: { id: true } }),
  ])

  const [
    clientLocation,
    contact,
    vendorLocation,
    vendorContact,
    vendorAttachment,
    customField,
    quote,
    template,
    salesOrder,
    purchaseOrder,
    purchaseOrder2,
    asset,
    workflow,
  ] = await Promise.all([
    prisma.clientLocation.findFirst({ where: { name: n.clientLocation, client: { companyId } }, select: { id: true } }),
    prisma.contact.findFirst({
      where: { firstName: n.contactFirstName, lastName: n.contactLastName, client: { companyId } },
      select: { id: true },
    }),
    prisma.vendorLocation.findFirst({ where: { name: n.vendorLocation, vendor: { companyId } }, select: { id: true } }),
    prisma.vendorContact.findFirst({
      where: { firstName: n.vendorContactFirstName, lastName: n.vendorContactLastName, vendor: { companyId } },
      select: { id: true },
    }),
    prisma.vendorAttachment.findFirst({ where: { fileName: n.vendorAttachment, vendor: { companyId } }, select: { id: true } }),
    prisma.inventoryCustomField.findFirst({ where: { companyId, name: n.customField }, select: { id: true } }),
    prisma.quote.findFirst({ where: { companyId, title: n.quote }, select: { id: true } }),
    prisma.quoteTemplate.findFirst({ where: { companyId, name: n.template }, select: { id: true } }),
    prisma.salesOrder.findFirst({ where: { companyId, internalNotes: n.salesOrder }, select: { id: true } }),
    prisma.purchaseOrder.findFirst({ where: { companyId, internalNotes: n.purchaseOrder }, select: { id: true } }),
    prisma.purchaseOrder.findFirst({ where: { companyId, internalNotes: n.purchaseOrder2 }, select: { id: true } }),
    prisma.inventoryAsset.findFirst({ where: { companyId, serialNumber: n.assetSerial }, select: { id: true } }),
    prisma.approvalWorkflow.findFirst({ where: { companyId, name: n.workflow }, select: { id: true } }),
  ])

  const [quoteLine, soLine, soComment, soAttachment, poLine, poComment, poAttachment, assetAttachment] = await Promise.all([
    prisma.quoteLineItem.findFirst({ where: { name: n.quoteLine, quote: { companyId } }, select: { id: true } }),
    prisma.sOLineItem.findFirst({ where: { name: n.soLine, salesOrder: { companyId } }, select: { id: true } }),
    prisma.sOComment.findFirst({ where: { message: n.soComment, salesOrder: { companyId } }, select: { id: true } }),
    prisma.sOAttachment.findFirst({ where: { fileName: n.soAttachment, salesOrder: { companyId } }, select: { id: true } }),
    prisma.pOLineItem.findFirst({
      where: { name: n.poLine, purchaseOrderId: id(purchaseOrder), purchaseOrder: { companyId } },
      select: { id: true },
    }),
    prisma.pOComment.findFirst({ where: { message: n.poComment, purchaseOrder: { companyId } }, select: { id: true } }),
    prisma.pOAttachment.findFirst({ where: { fileName: n.poAttachment, purchaseOrder: { companyId } }, select: { id: true } }),
    prisma.inventoryAssetAttachment.findFirst({ where: { fileName: n.assetAttachment, asset: { companyId } }, select: { id: true } }),
  ])

  const ids: SampleIds = {
    companyId,
    adminId: id(admin),
    globalAdminRoleId: id(globalAdminRole),
    everyoneRoleId: id(everyoneRole),
    industryId: id(industry),
    contactTagId: id(contactTag),
    clientId: id(client),
    clientLocationId: id(clientLocation),
    contactId: id(contact),
    vendorId: id(vendor),
    vendorLocationId: id(vendorLocation),
    vendorContactId: id(vendorContact),
    vendorAttachmentId: id(vendorAttachment),
    categoryId: id(category),
    customFieldId: id(customField),
    catalogItemId: id(catalogItem),
    quoteId: id(quote),
    quoteLineId: id(quoteLine),
    templateId: id(template),
    salesOrderId: id(salesOrder),
    soLineId: id(soLine),
    soCommentId: id(soComment),
    soAttachmentId: id(soAttachment),
    purchaseOrderId: id(purchaseOrder),
    purchaseOrder2Id: id(purchaseOrder2),
    poLineId: id(poLine),
    poCommentId: id(poComment),
    poAttachmentId: id(poAttachment),
    assetId: id(asset),
    assetAttachmentId: id(assetAttachment),
    workflowId: id(workflow),
  }

  const missing = Object.entries(ids)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`${n.company} is missing sample records (${missing.join(", ")}). Run create-test-companies again to top them up.`)
  }
  return ids
}
