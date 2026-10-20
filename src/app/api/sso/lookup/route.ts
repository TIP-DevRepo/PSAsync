import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp, rateLimitedResponse, recordFailure } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  // Says whether an email's company uses SSO, so every call counts toward
  // the IP limit (there is no failure state). Fails open.
  const limit = await recordFailure("sso-lookup", getClientIp(req))
  if (limit.blocked) return rateLimitedResponse(limit.retryAfterSeconds)

  const body = await req.json().catch(() => ({}))
  const email = body.email as string | undefined

  if (!email) {
    return NextResponse.json({ ssoRequired: false })
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { company: { include: { settings: true } } },
  })

  const settings = user?.company?.settings
  const ssoRequired = !!(
    settings?.ssoEnabled &&
    settings.microsoftClientId &&
    settings.microsoftTenantId
  )

  return NextResponse.json({ ssoRequired })
}