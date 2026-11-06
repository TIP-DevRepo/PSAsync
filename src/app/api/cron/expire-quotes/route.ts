import { NextRequest, NextResponse } from "next/server"
import { EXPIRE_QUOTES_DEFAULT_LIMIT, expireOverdueQuotes } from "@/lib/quote-expiry-job"
import { cronRefusal } from "@/lib/cron-auth"

// The daily quote expiry job, called by Vercel Cron (vercel.json, once a
// day at 06:00 UTC, production deployments only). Public in the route
// access check: it has no session, and is protected by CRON_SECRET
// instead (cronRefusal in src/lib/cron-auth.ts, shared with the ticket auto
// close job). Vercel sends "Authorization: Bearer <CRON_SECRET>" with every
// cron call once the variable is set in the project.
//
// Without CRON_SECRET configured it never runs (503). A missing or wrong
// secret is a 401 with no details. Otherwise it expires at most
// EXPIRE_QUOTES_DEFAULT_LIMIT quotes (src/lib/quote-expiry-job.ts) and
// answers counts only, never quote contents.

export const runtime = "nodejs"
// 200 quotes, one short transaction each, stay well inside this
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const refused = cronRefusal(req)
  if (refused) return refused

  const result = await expireOverdueQuotes({ limit: EXPIRE_QUOTES_DEFAULT_LIMIT })
  const summary = {
    checked: result.checked,
    expired: result.expired,
    skipped: result.skipped,
    errors: result.errors.length,
    limitReached: result.limitReached,
  }
  // One line: counts, plus the first failures by quote id and error kind
  // (errorSummary: no values, tokens, or customer data)
  const failures = result.errors.slice(0, 3).map((e) => `${e.quoteId}: ${e.error}`)
  const log = `Quote expiry: checked ${summary.checked}, expired ${summary.expired}, skipped ${summary.skipped}, errors ${summary.errors}` +
    (summary.limitReached ? ", limit reached" : "") +
    (failures.length > 0 ? ` (${failures.join("; ")})` : "")
  if (summary.errors > 0) console.error(log)
  else console.warn(log)
  return NextResponse.json(summary)
}
