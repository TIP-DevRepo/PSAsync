import { NextRequest, NextResponse } from "next/server"
import { signIn } from "@/auth"
import { createSsoRelayToken } from "@/lib/sso-relay-token"
import { prisma } from "@/lib/prisma"
import { checkSsoTenant } from "@/lib/sso-tenant"
import { decideFirstSignIn, firstSignInEmails, readSsoClaims } from "@/lib/sso-match"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")
  const msError = req.nextUrl.searchParams.get("error_description")
  const expectedState = req.cookies.get("sso_state")?.value
  const companyId = req.cookies.get("sso_company")?.value

  if (msError) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msError)}`, req.url))
  }
  if (!code || !state || state !== expectedState || !companyId) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", req.url))
  }

  const settings = await prisma.companySettings.findUnique({ where: { companyId } })
  if (
    !settings?.ssoEnabled ||
    !settings.microsoftClientId ||
    !settings.microsoftTenantId ||
    !settings.microsoftClientSecret
  ) {
    return NextResponse.redirect(new URL("/login?error=sso_not_available", req.url))
  }

  const redirectUri = `${req.nextUrl.origin}/api/sso/callback`

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
    return NextResponse.redirect(new URL("/login?error=token_exchange_failed", req.url))
  }
  const tokens = await tokenRes.json()

  // The account must belong to the company's own Microsoft directory. The
  // id token comes straight from Microsoft's token endpoint above, so its
  // tid claim is trusted without a signature check. A tenant saved as a
  // domain name can't be compared with tid and is skipped (see
  // checkSsoTenant). Nothing is created or linked when this fails.
  if (checkSsoTenant(settings.microsoftTenantId, tokens.id_token) === "mismatch") {
    return NextResponse.redirect(new URL("/login?error=wrong_tenant", req.url))
  }

  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!meRes.ok) {
    return NextResponse.redirect(new URL("/login?error=could_not_read_profile", req.url))
  }
  const me = await meRes.json()
  // The mailbox address, used only for the mailbox connection saved below.
  // It is never used to decide who is signing in, since a directory admin
  // can set the mail attribute to any address.
  const email: string | undefined = me.mail || me.userPrincipalName
  const claims = readSsoClaims(tokens.id_token)
  // The id token's oid and Graph's id are the same object id
  const msId: string | null = claims?.oid ?? (typeof me.id === "string" && me.id ? me.id : null)

  if (!email) {
    return NextResponse.redirect(new URL("/login?error=no_email_on_account", req.url))
  }

  // Identity comes only from what Microsoft just verified, never from
  // anything the browser sent us. A user already linked to this Microsoft
  // account signs in by that link, as before.
  let user = msId
    ? await prisma.user.findFirst({ where: { companyId, microsoftId: msId } })
    : null

  // First sign in: the stored PSAsync email must equal the id token's sign
  // in name (preferred_username) or email claim, ignoring case. The rules
  // (one match only, never relink an account or overwrite a link) are in
  // decideFirstSignIn.
  if (!user) {
    const emails = firstSignInEmails(claims)
    if (emails.length === 0) {
      return NextResponse.redirect(new URL("/login?error=no_email_on_account", req.url))
    }
    const [matches, linked] = await Promise.all([
      prisma.user.findMany({
        where: { companyId, OR: emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })) },
        select: { id: true, email: true, active: true, microsoftId: true },
      }),
      msId ? prisma.user.findFirst({ where: { microsoftId: msId }, select: { id: true } }) : null,
    ])
    const decision = decideFirstSignIn(emails, matches, msId, linked?.id ?? null)
    if (!decision.ok) {
      return NextResponse.redirect(new URL(`/login?error=${decision.error}`, req.url))
    }
    user = await prisma.user.findFirst({ where: { id: decision.userId, companyId } })
  }

  if (!user || !user.active) {
    return NextResponse.redirect(new URL("/login?error=no_account_found", req.url))
  }

  // Link the Microsoft account and auto-save the mailbox/calendar
  // connection, so there's no separate "connect your mailbox" step. A
  // mailbox row someone else already owns is left exactly as it is: signing
  // in never takes over another user's connection. A row with no owner left
  // goes to whoever signs in, same as reconnecting from Settings.
  const existingConnection = await prisma.microsoftConnection.findUnique({
    where: { companyId_email: { companyId, email } },
    select: { connectedByUserId: true },
  })
  const ownedByOther =
    !!existingConnection?.connectedByUserId && existingConnection.connectedByUserId !== user.id

  await prisma.$transaction([
    // Only written when it changes: a first sign in, never a different link
    ...(msId && user.microsoftId !== msId
      ? [prisma.user.update({ where: { id: user.id }, data: { microsoftId: msId } })]
      : []),
    ...(ownedByOther
      ? []
      : [
          prisma.microsoftConnection.upsert({
            where: { companyId_email: { companyId, email } },
            update: {
              label: user.name,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              connectedByUserId: user.id,
            },
            create: {
              companyId,
              label: user.name,
              email,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              connectedByUserId: user.id,
            },
          }),
        ]),
  ])

  const relayToken = createSsoRelayToken(user.id)
  // NextAuth issues the actual session cookie itself here — we never
  // construct one by hand
  await signIn("sso", { token: relayToken, redirect: false })

  const response = NextResponse.redirect(new URL("/dashboard", req.url))
  response.cookies.delete("sso_state")
  response.cookies.delete("sso_company")
  return response
}