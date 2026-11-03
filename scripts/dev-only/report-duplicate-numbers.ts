// DEV ONLY, READ ONLY. Lists every company and record number used by more
// than one row, for each record number with a unique constraint: quotes
// (number and version together, since every version shares its family's
// number), sales orders, and purchase orders (NUMBER_SOURCES in
// lib/duplicate-numbers.ts). Run it before the migration that adds those
// constraints: any duplicate it lists would make that migration fail, so
// each one has to be renumbered by hand first.
//
// By default it follows the dev-only guard (lib/guard.ts): DB_NAME must be
// exactly psasync_dev, NODE_ENV not production, and --yes passed. Run from
// the repo root:
//   npx tsx scripts/dev-only/report-duplicate-numbers.ts --yes
//
// Because it never writes, it may also read the live database, the same way
// report-file-links.ts does: DB_NAME exactly psasync with both --yes and
// --allow-live-read-only. No env file is loaded then, so DB_HOST, DB_NAME,
// DB_USER, and DB_PASSWORD must be set in the shell, and it stops until the
// database name is typed exactly. Every write and raw query method on the
// database client throws.
//
// Exit codes: 0 report printed, 1 refused or not confirmed, 2 failed.

import { createInterface } from "readline/promises"
import { CONFIRM_FLAG, enforceDevGuard } from "./lib/guard"
import { readOnlyClient } from "./lib/read-only-client"
import { findDuplicates, NUMBER_SOURCES, type DuplicateGroup } from "./lib/duplicate-numbers"

const SCRIPT = "report-duplicate-numbers"
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
  if (liveRequested) await confirmLive(target.name)

  // Imported only after the target has passed
  const { prisma } = await import("@/lib/prisma")
  const db = readOnlyClient(prisma)

  console.log(`Database: ${target.name} on ${target.host}`)
  console.log("")

  const found: DuplicateGroup[] = []
  for (const source of NUMBER_SOURCES) {
    const groups = findDuplicates(source.model, await source.load(db))
    found.push(...groups)
    if (groups.length === 0) {
      console.log(`${source.model} ${source.constraint}: no duplicates`)
      continue
    }
    console.log(`${source.model} ${source.constraint}: ${groups.length} duplicate ${groups.length === 1 ? "number" : "numbers"}`)
    for (const group of groups) {
      console.log(`  company ${group.companyId}  ${group.number}  used by ${group.rows.length} rows:`)
      for (const row of group.rows) {
        console.log(`    id ${row.id}  created ${row.createdAt.toISOString()}  ${row.label}`)
      }
    }
  }

  console.log("")
  if (found.length === 0) {
    console.log("No duplicates found.")
  } else {
    const rows = found.reduce((sum, group) => sum + group.rows.length, 0)
    console.log(`${found.length} duplicate ${found.length === 1 ? "number" : "numbers"} found (${rows} rows). Renumber them before running the migration that adds the unique constraints.`)
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
