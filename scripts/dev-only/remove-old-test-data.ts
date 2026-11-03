// DEV ONLY, run once. Removes the persistent test data the old test data
// script (now deleted) made, now that every check makes and removes its
// own temporary data (lib/run-data.ts).
//
// It finds the old data by the same rule that script used: a company whose
// name is exactly "Test Company B" or "Test Company C" (it looked each one
// up with company.findFirst({ where: { name } })). Every user it made, and
// every user the old checks added (Test Limited, Sender, Viewer, Manager,
// Approver), belongs to one of those companies, as does every record. It
// lists the companies, their users' emails, and how many rows each table
// holds, then deletes only after "delete" is typed. Anything else exits 1.
// The rows go in one transaction, in foreign key order, then any stored
// files they pointed to in the uploads bucket are deleted with the app's own
// delete helper.
//
// Refuses to run unless DB_NAME is exactly psasync_dev, NODE_ENV is not
// production, and --yes is passed (lib/guard.ts). Run from the repo root:
//   npx tsx scripts/dev-only/remove-old-test-data.ts --yes
//
// Exit codes: 0 deleted or nothing to delete, 1 not confirmed, 2 failed.

import { createInterface } from "readline/promises"
import { enforceDevGuard } from "./lib/guard"
import { countCompanyRows, deleteCompanies, describeCounts, storedFiles } from "./lib/run-data"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("remove-old-test-data")

// The exact names the old test data script gave its companies
const OLD_TEST_COMPANY_NAMES = ["Test Company B", "Test Company C"] as const

async function askToConfirm(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Input that ends before a line is typed counts as not confirmed
  const closed = new Promise<string>((resolve) => rl.once("close", () => resolve("")))
  const typed = await Promise.race([rl.question('Type delete to remove all of it: ').catch(() => ""), closed])
  rl.close()
  return typed
}

async function main(): Promise<number> {
  // Imported only after the guard passed
  const { prisma } = await import("@/lib/prisma")
  try {
    const companies = await prisma.company.findMany({
      where: { name: { in: [...OLD_TEST_COMPANY_NAMES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    if (companies.length === 0) {
      console.log("No old test data found: no company is named Test Company B or Test Company C.")
      return 0
    }
    const ids = companies.map((c) => c.id)
    const users = await prisma.user.findMany({ where: { companyId: { in: ids } }, select: { email: true, companyId: true }, orderBy: { email: "asc" } })
    const counts = await countCompanyRows(prisma, ids)
    const files = await storedFiles(prisma, ids)

    console.log("This will delete:")
    for (const company of companies) {
      console.log(`  ${company.name} (${company.id})`)
      for (const user of users.filter((u) => u.companyId === company.id)) console.log(`    user ${user.email}`)
    }
    const unusual = users.filter((u) => !u.email.toLowerCase().endsWith("@example.test"))
    if (unusual.length > 0) {
      console.log(`  Note: ${unusual.length} of these users have an email outside example.test, so someone added them by hand. They are deleted too.`)
    }
    console.log(`  Rows per table: ${describeCounts(counts)}`)
    console.log(`  Stored file links: ${files.length} (only ones in the uploads bucket are deleted from S3)`)
    console.log("")

    const typed = await askToConfirm()
    if (typed !== "delete") {
      console.log("Not confirmed. Nothing was deleted.")
      return 1
    }

    const result = await deleteCompanies(prisma, ids)
    console.log(`Deleted ${companies.length} companies and ${result.counts.User ?? 0} users.`)
    console.log(`Rows deleted per table: ${describeCounts(result.counts)}`)
    console.log(`Stored files: ${result.files.deleted} deleted from S3, ${result.files.failed} could not be deleted, ${result.files.notInBucket} links were not in the uploads bucket.`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`remove-old-test-data failed: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}. Nothing was deleted if the database step failed.`)
    process.exit(2)
  })
