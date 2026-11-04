// DEV ONLY. Runs the daily quote expiry job (expireOverdueQuotes in
// src/lib/quote-expiry-job.ts, the same function GET /api/cron/expire-quotes
// calls) against the dev database by hand.
//
// A dry run by default: it lists every quote that would expire (quote
// number and version, company, Valid until date, and the linked
// opportunity's number) and changes nothing. --apply expires them, through
// the same status change path staff use, with System as the actor, so each
// one's opportunity, timeline, and audit log follow.
//
// Refuses to run unless DB_NAME is exactly psasync_dev, NODE_ENV is not
// production, and --yes is passed (lib/guard.ts). Run from the repo root:
//   npx tsx scripts/dev-only/run-quote-expiry.ts --yes
//   npx tsx scripts/dev-only/run-quote-expiry.ts --yes --apply
//   npx tsx scripts/dev-only/run-quote-expiry.ts --yes --company <company id>
// --limit <n> changes the batch size (default 200, the cron's).
//
// Exit codes: 0 done (nothing failed), 1 refused or bad arguments, 2 a
// quote failed to expire or the run broke.

import { enforceDevGuard } from "./lib/guard"

const SCRIPT = "run-quote-expiry"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard(SCRIPT)

function readArgs(argv: readonly string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    if (i === -1) return undefined
    const v = argv[i + 1]
    if (!v || v.startsWith("--")) {
      console.log(`Refusing to run: ${flag} needs a value.`)
      process.exit(1)
    }
    return v
  }
  const company = value("--company")
  const limitText = value("--limit")
  const limit = limitText === undefined ? undefined : Number(limitText)
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    console.log("Refusing to run: --limit must be a whole number, 1 or more.")
    process.exit(1)
  }
  return { apply: argv.includes("--apply"), company, limit }
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2))
  // Imported only after the guard passed
  const { prisma } = await import("@/lib/prisma")
  const { expireOverdueQuotes, EXPIRE_QUOTES_DEFAULT_LIMIT } = await import("@/lib/quote-expiry-job")
  const { formatValidUntil } = await import("@/lib/quote-expiry")

  try {
    if (args.company && !(await prisma.company.findUnique({ where: { id: args.company }, select: { id: true } }))) {
      console.log(`Refusing to run: no company with id ${args.company}.`)
      return 1
    }

    const result = await expireOverdueQuotes({
      dryRun: !args.apply,
      companyIds: args.company ? [args.company] : undefined,
      limit: args.limit ?? EXPIRE_QUOTES_DEFAULT_LIMIT,
    })

    const companies = new Map(
      (await prisma.company.findMany({ where: { id: { in: [...new Set(result.items.map((i) => i.companyId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name])
    )
    const opportunityIds = result.items.map((i) => i.opportunityId).filter((id): id is string => !!id)
    const opportunities = new Map(
      (await prisma.opportunity.findMany({ where: { id: { in: opportunityIds } }, select: { id: true, number: true } })).map((o) => [o.id, o.number])
    )

    console.log(`\n${args.apply ? "Expired" : "Would expire"} (${result.items.length}):`)
    if (result.items.length === 0) console.log("  none")
    for (const item of result.items) {
      const opportunity = item.opportunityId ? (opportunities.get(item.opportunityId) ?? "(deleted)") : "none"
      console.log(
        `  ${item.quoteNumber} v${item.version}  company ${companies.get(item.companyId) ?? item.companyId}  ` +
          `valid until ${formatValidUntil(item.expiresAt)}  opportunity ${opportunity}`
      )
    }
    for (const e of result.errors) console.log(`  FAILED ${e.quoteId}: ${e.error}`)

    console.log(
      `\n${SCRIPT}: checked ${result.checked}, ${args.apply ? "expired" : "would expire"} ${result.expired}, ` +
        `skipped ${result.skipped}, errors ${result.errors.length}${result.limitReached ? ", limit reached (run again for more)" : ""}.`
    )
    if (!args.apply && result.items.length > 0) console.log("Nothing was changed. Run again with --apply to expire them.")
    return result.errors.length > 0 ? 2 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`${SCRIPT} failed: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}`)
    process.exit(2)
  })
