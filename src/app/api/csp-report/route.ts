import { NextRequest, NextResponse } from "next/server"
import { isReportContentType, readLimitedText, readViolations, violationLogLine } from "@/lib/csp-report"
import { getClientIp, rateLimitedResponse, recordFailure } from "@/lib/rate-limit"

// Where browsers send Content-Security-Policy violation reports (the
// report-uri and report-to of the policy in src/lib/security-headers.ts).
// Public, since browsers send them without credentials. Reads at most
// 10 KB, logs one line with only the directive, the blocked origin, and
// the page path, stores nothing, and never echoes the report. Every report
// counts toward the "csp-report" IP limit so it can't be used to flood the
// logs. Always answers 204 (429 past the limit) and never throws.
export async function POST(req: NextRequest) {
  try {
    const limit = await recordFailure("csp-report", getClientIp(req))
    if (limit.blocked) return rateLimitedResponse(limit.retryAfterSeconds)

    if (!isReportContentType(req.headers.get("content-type"))) return noContent()
    const text = await readLimitedText(req)
    if (!text) return noContent()

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return noContent()
    }

    const line = violationLogLine(readViolations(parsed))
    if (line) console.warn(line)
  } catch {
    // A bad report is never worth an error
  }
  return noContent()
}

function noContent() {
  return new NextResponse(null, { status: 204 })
}
