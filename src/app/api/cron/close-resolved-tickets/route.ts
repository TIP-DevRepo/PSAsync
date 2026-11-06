import { NextRequest, NextResponse } from "next/server"
import { CLOSE_TICKETS_DEFAULT_LIMIT, closeResolvedTickets } from "@/lib/ticket-autoclose-job"
import { cronRefusal } from "@/lib/cron-auth"

// The daily ticket auto close job, called by Vercel Cron (vercel.json, once
// a day at 06:15 UTC, production deployments only), protected by
// CRON_SECRET the same way as the quote expiry job (cronRefusal). It closes
// at most CLOSE_TICKETS_DEFAULT_LIMIT resolved tickets that had no customer
// reply for their company's auto close days (src/lib/ticket-autoclose-job.ts)
// and answers counts only, never ticket contents.

export const runtime = "nodejs"
// 200 tickets, one short transaction each, stay well inside this
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const refused = cronRefusal(req)
  if (refused) return refused

  const result = await closeResolvedTickets({ limit: CLOSE_TICKETS_DEFAULT_LIMIT })
  const summary = {
    checked: result.checked,
    closed: result.closed,
    skipped: result.skipped,
    errors: result.errors.length,
    limitReached: result.limitReached,
  }
  // One line: counts, plus the first failures by ticket id and error kind
  // (errorSummary: no values or customer data)
  const failures = result.errors.slice(0, 3).map((e) => `${e.ticketId}: ${e.error}`)
  const log = `Ticket auto close: checked ${summary.checked}, closed ${summary.closed}, skipped ${summary.skipped}, errors ${summary.errors}` +
    (summary.limitReached ? ", limit reached" : "") +
    (failures.length > 0 ? ` (${failures.join("; ")})` : "")
  if (summary.errors > 0) console.error(log)
  else console.warn(log)
  return NextResponse.json(summary)
}
