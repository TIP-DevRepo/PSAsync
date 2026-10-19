import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

const RECONNECT_REFUSED =
  "You can only reconnect your own mailbox. Reconnecting someone else's mailbox, or the shared quote sender, needs Integrations access."

export async function GET(req: NextRequest) {
  const { ctx, response: refusal } = await requireAccess()
  if (refusal) {
    return refusal.status === 401
      ? NextResponse.redirect(new URL("/login", req.url))
      : NextResponse.redirect(
          new URL(`/dashboard/settings?panel=microsoft&error=${encodeURIComponent("You need to change your password before connecting a mailbox.")}`, req.url)
        )
  }

  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")
  const msError = req.nextUrl.searchParams.get("error_description")
  const expectedState = req.cookies.get("ms_oauth_state")?.value
  const label = req.cookies.get("ms_oauth_label")?.value

  if (msError) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?panel=microsoft&error=${encodeURIComponent(msError)}`, req.url)
    )
  }
  if (!code || !state || state !== expectedState || !label) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=invalid_state", req.url)
    )
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
  })
  if (!settings?.microsoftClientId || !settings?.microsoftTenantId || !settings?.microsoftClientSecret) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=missing_credentials", req.url)
    )
  }

  const redirectUri = `${req.nextUrl.origin}/api/microsoft/callback`

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${settings.microsoftTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.microsoftClientId,
        client_secret: settings.microsoftClientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }
  )

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    console.error("Microsoft token exchange failed:", errText)
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=token_exchange_failed", req.url)
    )
  }

  const tokens = await tokenRes.json()

  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const me = meRes.ok ? await meRes.json() : null
  const email = me?.mail || me?.userPrincipalName || null

  if (!email) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?panel=microsoft&error=could_not_read_email", req.url)
    )
  }

  // Reconnecting a mailbox someone else connected, or the one Quote
  // Settings sends every quote from, needs Integrations access
  const existing = await prisma.microsoftConnection.findUnique({
    where: { companyId_email: { companyId: ctx.companyId, email } },
    select: { id: true, connectedByUserId: true },
  })
  if (existing) {
    const someoneElses = existing.connectedByUserId !== ctx.userId
    const isSharedSender = settings.quoteSendFromConnectionId === existing.id
    if ((someoneElses || isSharedSender) && !ctx.can("settingsSections.integrations")) {
      const refused = NextResponse.redirect(
        new URL(`/dashboard/settings?panel=microsoft&error=${encodeURIComponent(RECONNECT_REFUSED)}`, req.url)
      )
      refused.cookies.delete("ms_oauth_state")
      refused.cookies.delete("ms_oauth_label")
      return refused
    }
  }

  // One row per connected mailbox — reconnecting the same mailbox updates
  // its tokens and label rather than creating a duplicate. A reconnect keeps
  // the mailbox's owner, so an admin refreshing a rep's mailbox never takes
  // it over. Only a mailbox with no owner left is given to whoever
  // reconnects it.
  await prisma.microsoftConnection.upsert({
    where: {
      companyId_email: { companyId: ctx.companyId, email },
    },
    update: {
      label,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      connectedByUserId: existing?.connectedByUserId ?? ctx.userId,
    },
    create: {
      companyId: ctx.companyId,
      label,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      connectedByUserId: ctx.userId,
    },
  })

  const response = NextResponse.redirect(
    new URL("/dashboard/settings?panel=microsoft&connected=1", req.url)
  )
  response.cookies.delete("ms_oauth_state")
  response.cookies.delete("ms_oauth_label")
  return response
}