import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

// The guard every Vercel Cron route shares (GET /api/cron/expire-quotes and
// GET /api/cron/close-resolved-tickets). They are public in the route
// access check: they have no session, and are protected by CRON_SECRET
// instead. Vercel sends "Authorization: Bearer <CRON_SECRET>" with every
// cron call once the variable is set in the project. Without CRON_SECRET
// configured a cron route never runs (503); a missing or wrong secret is a
// 401 with no details.

// Compared as fixed length digests, so the time taken says nothing about
// how much of the secret matched or how long it is
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

// The refusal to answer, or null when the request carries the secret
export function cronRefusal(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 })

  const header = req.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  if (!given || !secretMatches(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return null
}
