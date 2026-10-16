import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

const SCOPES = "openid profile offline_access User.Read Mail.Send Mail.ReadWrite"

// Any active user may connect their own mailbox. Whether a reconnect of an
// existing mailbox is allowed is only known once Microsoft says which
// account was picked, so the callback checks that.
export async function GET(req: NextRequest) {
  const { ctx, response: refusal } = await requireAccess()
  if (refusal) {
    return refusal.status === 401
      ? NextResponse.redirect(new URL("/login", req.url))
      : NextResponse.redirect(
          new URL(`/dashboard/settings?panel=microsoft&error=${encodeURIComponent("You need to change your password before connecting a mailbox.")}`, req.url)
        )
  }

  const label = req.nextUrl.searchParams.get("label")?.trim()
  if (!label) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=missing_label", req.url)
    )
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
  })

  if (!settings?.microsoftClientId || !settings?.microsoftTenantId) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=missing_credentials", req.url)
    )
  }

  const redirectUri = `${req.nextUrl.origin}/api/microsoft/callback`
  const state = crypto.randomUUID()

  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${settings.microsoftTenantId}/oauth2/v2.0/authorize`
  )
  authorizeUrl.searchParams.set("client_id", settings.microsoftClientId)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("response_mode", "query")
  authorizeUrl.searchParams.set("scope", SCOPES)
  authorizeUrl.searchParams.set("state", state)
  // Let the user pick which account to sign into, rather than silently
  // reusing whichever Microsoft session is already active in the browser —
  // important since they may be connecting a second or third mailbox
  authorizeUrl.searchParams.set("prompt", "select_account")

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })
  response.cookies.set("ms_oauth_label", label, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })

  return response
}