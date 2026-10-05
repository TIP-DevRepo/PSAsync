import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules"
import { usesMicrosoftSso } from "@/lib/sso-account"

// Changes the signed in user's own password. The user is always taken from
// the session, never from the request body, and no password or hash is ever
// logged or echoed back in a response.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      password: true,
      active: true,
      company: { select: { settings: { select: { ssoEnabled: true } } } },
    },
  })

  if (!user || !user.active) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (usesMicrosoftSso(user.company.settings)) {
    return NextResponse.json(
      { error: "Your account signs in with Microsoft, so your password is managed there." },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : ""
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : ""

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: "All password fields are required" }, { status: 400 })
  }

  if (!user.password) {
    return NextResponse.json(
      { error: "Your account has no password to change. Contact your administrator." },
      { status: 400 }
    )
  }

  // 400 rather than 401 so the client doesn't read a wrong current password
  // as an expired session
  const currentMatches = await bcrypt.compare(currentPassword, user.password)
  if (!currentMatches) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    )
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "New password and confirmation don't match" }, { status: 400 })
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from your current password" },
      { status: 400 }
    )
  }

  // Same library and cost factor the user invite flow uses, so login's
  // bcrypt.compare in src/auth.ts verifies it unchanged
  const hashedPassword = await bcrypt.hash(newPassword, 10)

  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashedPassword },
  })

  return NextResponse.json({ ok: true })
}
