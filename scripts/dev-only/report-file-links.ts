// DEV ONLY, READ ONLY. Counts every stored file link, grouped by table,
// column, and bucket host, and lists each row whose link does not point to
// the configured uploads bucket (AWS_S3_BUCKET_NAME in AWS_REGION, the same
// base storeUpload builds links from). Only hosts are printed, never a full
// link.
//
// The file link columns, from prisma/schema.prisma (every column storeUpload
// writes to): Company.logoUrl, Company.secondaryLogoUrl, Vendor.logoUrl,
// VendorAttachment.fileUrl, SOAttachment.fileUrl, POAttachment.fileUrl,
// InventoryAssetAttachment.fileUrl, and OpportunityAttachment.fileUrl. A
// new file column gets a source in
// SOURCES below.
//
// By default it follows the dev-only guard (lib/guard.ts): DB_NAME must be
// exactly psasync_dev, NODE_ENV not production, and --yes passed. Run from
// the repo root:
//   npx tsx scripts/dev-only/report-file-links.ts --yes
//
// Because it never writes, and only this script, it may also read the live
// database: DB_NAME exactly psasync with both --yes and
// --allow-live-read-only. No env file is loaded then, so DB_HOST, DB_NAME,
// DB_USER, DB_PASSWORD, AWS_S3_BUCKET_NAME, and AWS_REGION must be set in the
// shell, and it stops until the database name is typed exactly. Every write
// and raw query method on the database client throws.
//
// Exit codes: 0 report printed, 1 refused or not confirmed, 2 failed.

import { createInterface } from "readline/promises"
import type { PrismaClient } from "@/generated/prisma"
import { CONFIRM_FLAG, enforceDevGuard } from "./lib/guard"
import { readOnlyClient } from "./lib/read-only-client"

const SCRIPT = "report-file-links"
const LIVE_FLAG = "--allow-live-read-only"
const LIVE_DB_NAME = "psasync"

const argv = process.argv.slice(2)
const liveRequested = argv.includes(LIVE_FLAG)

function refuse(message: string): never {
  console.log(`Refusing to run: ${message}`)
  process.exit(1)
}

// The live exception, checked only when --allow-live-read-only is given.
// Nothing is loaded from any env file, so a missing variable can never be
// filled in from the dev settings and point the client somewhere else.
function liveTarget(): { host: string; name: string } {
  const host = process.env.DB_HOST || "(not set)"
  const name = process.env.DB_NAME || "(not set)"
  console.log(`${SCRIPT}: database host ${host}, database name ${name}`)
  if (process.env.DB_NAME !== LIVE_DB_NAME) {
    refuse(`${LIVE_FLAG} only reads the live database "${LIVE_DB_NAME}", got ${process.env.DB_NAME ? `"${process.env.DB_NAME}"` : "nothing"}. Run without it for the dev database.`)
  }
  if (!argv.includes(CONFIRM_FLAG)) refuse(`the ${CONFIRM_FLAG} flag is required to proceed.`)
  return { host, name }
}

// Must stay first: nothing below may run before the target has passed
const target = liveRequested ? liveTarget() : enforceDevGuard(SCRIPT)

interface LinkRow {
  table: string
  column: string
  id: string
  companyId: string
  label: string
  url: string
}

// One source per file link column. Labels are what a person would look for
// in the app: the company or vendor name, the record number, the file name.
const SOURCES: { table: string; column: string; load: (db: PrismaClient) => Promise<LinkRow[]> }[] = [
  {
    table: "Company",
    column: "logoUrl",
    load: async (db) =>
      (await db.company.findMany({ where: { logoUrl: { not: null } }, select: { id: true, name: true, logoUrl: true } })).map((r) => ({
        table: "Company", column: "logoUrl", id: r.id, companyId: r.id, label: r.name, url: r.logoUrl ?? "",
      })),
  },
  {
    table: "Company",
    column: "secondaryLogoUrl",
    load: async (db) =>
      (await db.company.findMany({ where: { secondaryLogoUrl: { not: null } }, select: { id: true, name: true, secondaryLogoUrl: true } })).map((r) => ({
        table: "Company", column: "secondaryLogoUrl", id: r.id, companyId: r.id, label: r.name, url: r.secondaryLogoUrl ?? "",
      })),
  },
  {
    table: "Vendor",
    column: "logoUrl",
    load: async (db) =>
      (await db.vendor.findMany({ where: { logoUrl: { not: null } }, select: { id: true, companyId: true, name: true, logoUrl: true } })).map((r) => ({
        table: "Vendor", column: "logoUrl", id: r.id, companyId: r.companyId, label: r.name, url: r.logoUrl ?? "",
      })),
  },
  {
    table: "VendorAttachment",
    column: "fileUrl",
    load: async (db) =>
      (await db.vendorAttachment.findMany({ select: { id: true, fileName: true, fileUrl: true, vendor: { select: { companyId: true, name: true } } } })).map((r) => ({
        table: "VendorAttachment", column: "fileUrl", id: r.id, companyId: r.vendor.companyId, label: `${r.vendor.name}: ${r.fileName}`, url: r.fileUrl,
      })),
  },
  {
    table: "SOAttachment",
    column: "fileUrl",
    load: async (db) =>
      (await db.sOAttachment.findMany({ select: { id: true, fileName: true, fileUrl: true, salesOrder: { select: { companyId: true, soNumber: true } } } })).map((r) => ({
        table: "SOAttachment", column: "fileUrl", id: r.id, companyId: r.salesOrder.companyId, label: `${r.salesOrder.soNumber}: ${r.fileName}`, url: r.fileUrl,
      })),
  },
  {
    table: "POAttachment",
    column: "fileUrl",
    load: async (db) =>
      (await db.pOAttachment.findMany({ select: { id: true, fileName: true, fileUrl: true, purchaseOrder: { select: { companyId: true, poNumber: true } } } })).map((r) => ({
        table: "POAttachment", column: "fileUrl", id: r.id, companyId: r.purchaseOrder.companyId, label: `${r.purchaseOrder.poNumber}: ${r.fileName}`, url: r.fileUrl,
      })),
  },
  {
    table: "InventoryAssetAttachment",
    column: "fileUrl",
    load: async (db) =>
      (await db.inventoryAssetAttachment.findMany({ select: { id: true, fileName: true, fileUrl: true, asset: { select: { companyId: true, assetTag: true } } } })).map((r) => ({
        table: "InventoryAssetAttachment", column: "fileUrl", id: r.id, companyId: r.asset.companyId, label: `${r.asset.assetTag}: ${r.fileName}`, url: r.fileUrl,
      })),
  },
  {
    table: "OpportunityAttachment",
    column: "fileUrl",
    load: async (db) =>
      (await db.opportunityAttachment.findMany({ select: { id: true, fileName: true, fileUrl: true, opportunity: { select: { companyId: true, number: true } } } })).map((r) => ({
        table: "OpportunityAttachment", column: "fileUrl", id: r.id, companyId: r.opportunity.companyId, label: `${r.opportunity.number}: ${r.fileName}`, url: r.fileUrl,
      })),
  },
]

// Only the host of a link is ever shown
function linkHost(url: string): string {
  try {
    const host = new URL(url).host
    return host || "(no host)"
  } catch {
    return "(not a link)"
  }
}

async function confirmLive(name: string) {
  console.log("")
  console.log(`This reads the LIVE database "${name}" on ${target.host}. It never writes.`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Input that ends before a line is typed counts as not confirmed
  const closed = new Promise<string>((resolve) => rl.once("close", () => resolve("")))
  const typed = await Promise.race([rl.question(`Type the database name (${name}) to continue: `).catch(() => ""), closed])
  rl.close()
  if (typed !== name) refuse("the database name was not typed exactly.")
}

async function main() {
  if (!process.env.AWS_S3_BUCKET_NAME || !process.env.AWS_REGION) {
    refuse("AWS_S3_BUCKET_NAME and AWS_REGION must be set, or there is no configured bucket to compare links with.")
  }
  if (liveRequested) await confirmLive(target.name)

  // Imported only after the target has passed. bucketBaseUrl is the base
  // every stored link starts with; nothing here sends anything to S3.
  const { bucketBaseUrl } = await import("@/lib/uploads")
  const { prisma } = await import("@/lib/prisma")
  const db = readOnlyClient(prisma)

  const configuredHost = linkHost(bucketBaseUrl())
  console.log(`Database: ${target.name} on ${target.host}`)
  console.log(`Configured bucket host: ${configuredHost}`)
  console.log("")

  const rows: LinkRow[] = []
  for (const source of SOURCES) rows.push(...(await source.load(db)))

  // table.column -> host -> count, every column listed even when empty
  const counts = new Map<string, Map<string, number>>()
  for (const source of SOURCES) counts.set(`${source.table}.${source.column}`, new Map())
  for (const row of rows) {
    const byHost = counts.get(`${row.table}.${row.column}`)!
    const host = linkHost(row.url)
    byHost.set(host, (byHost.get(host) ?? 0) + 1)
  }

  console.log("Stored file links by table, column, and host:")
  for (const [column, byHost] of counts) {
    if (byHost.size === 0) {
      console.log(`  ${column}: none`)
      continue
    }
    for (const [host, count] of [...byHost].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${column}  ${host}${host === configuredHost ? " (configured)" : ""}  ${count}`)
    }
  }

  const foreign = rows.filter((row) => linkHost(row.url) !== configuredHost)
  console.log("")
  if (foreign.length === 0) {
    console.log(`Every stored link (${rows.length}) points to the configured bucket.`)
  } else {
    console.log(`${foreign.length} of ${rows.length} stored links do not point to the configured bucket:`)
    for (const row of foreign) {
      console.log(`  ${row.table}.${row.column}  id ${row.id}  company ${row.companyId}  ${row.label}  host ${linkHost(row.url)}`)
    }
  }

  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // The message only, never a stack or a connection string
    console.error(`${SCRIPT} failed: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}`)
    process.exit(2)
  })

