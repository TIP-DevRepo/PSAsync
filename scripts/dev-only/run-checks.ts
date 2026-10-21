// DEV ONLY. Runs all three dev checks against the locally running dev
// server with one set of temporary data: sweeps leftovers of earlier
// crashed runs, sets up this run's two test companies and every user and
// record the checks need (lib/run-data.ts), runs check-cross-company,
// check-permissions, and check-portal in that order, removes the data
// again, and prints one combined summary. The data is removed even when a
// check fails or breaks, and on Ctrl+C.
//
// Refuses to run unless DB_NAME is exactly psasync_dev, NODE_ENV is not
// production, and --yes is passed (lib/guard.ts), and only talks to a
// server on this machine. Start the dev server, then from the repo root:
//   npm run check:dev -- --yes --base-url http://localhost:3001
// --base-url defaults to http://localhost:3000.
//
// Exit codes: 0 every check passed, 1 a FAIL or UNEXPECTED, 2 a check's
// harness broke (or the setup did).

import type { PrismaClient } from "@/generated/prisma"
import { enforceDevGuard } from "./lib/guard"
import { readBaseUrl, type CheckResult } from "./lib/harness"
import { withRunData, type RunData } from "./lib/run-data"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("run-checks")

type Check = (prisma: PrismaClient, run: RunData, baseUrl: string) => Promise<CheckResult>

// Each check module is imported only here, after the guard passed. Its own
// guard runs again on import; it doesn't set up data or run by itself.
const CHECKS: { name: string; load: () => Promise<Check> }[] = [
  { name: "check-cross-company", load: async () => (await import("./check-cross-company")).checkCrossCompany },
  { name: "check-permissions", load: async () => (await import("./check-permissions")).checkPermissions },
  { name: "check-portal", load: async () => (await import("./check-portal")).checkPortal },
]

interface Outcome {
  name: string
  result?: CheckResult
  broken?: string
}

function printSummary(outcomes: Outcome[]) {
  console.log("\nCombined summary")
  const width = Math.max(...CHECKS.map((c) => c.name.length))
  for (const o of outcomes) {
    const status = o.broken
      ? `BROKEN: ${o.broken}`
      : `${o.result!.total} checks: ${o.result!.pass} PASS, ${o.result!.fail} FAIL, ${o.result!.unexpected} UNEXPECTED`
    console.log(`  ${o.name.padEnd(width)}  ${status}`)
  }
  const done = outcomes.filter((o) => o.result).map((o) => o.result!)
  const sum = (k: "total" | "pass" | "fail" | "unexpected") => done.reduce((n, r) => n + r[k], 0)
  console.log(`  ${"all".padEnd(width)}  ${sum("total")} checks: ${sum("pass")} PASS, ${sum("fail")} FAIL, ${sum("unexpected")} UNEXPECTED, ${outcomes.length - done.length} broken`)
}

// Runs every check in order with the shared data, whatever the earlier ones
// did
async function runAll(prisma: PrismaClient, run: RunData, baseUrl: string): Promise<number> {
  const outcomes: Outcome[] = []
  for (const check of CHECKS) {
    console.log(`\n=== ${check.name} ===`)
    try {
      const fn = await check.load()
      outcomes.push({ name: check.name, result: await fn(prisma, run, baseUrl) })
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : "unknown error"
      console.error(message)
      outcomes.push({ name: check.name, broken: message })
    }
  }
  printSummary(outcomes)
  if (outcomes.some((o) => o.broken)) return 2
  return outcomes.some((o) => o.result?.code !== 0) ? 1 : 0
}

async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  return withRunData("run-checks", (prisma, run) => runAll(prisma, run, baseUrl))
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // The setup itself failed (its data is already removed by now)
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  })
