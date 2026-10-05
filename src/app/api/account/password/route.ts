import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  passwordByteLength,
} from "@/lib/password-rules"
import { usesMicrosoftSso } from "@/lib/sso-account"

function lockedResponse(lockedUntil: Date) {
  const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000))
  return NextResponse.json(
    { error: `Too many incorrect attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` },
    { status: 429 }
  )
}

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
      passwordChangeLockedUntil: true,
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

  // Checked before any password comparison, so a locked account can't keep
  // guessing while it waits
  const lockedUntil = user.passwordChangeLockedUntil
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return lockedResponse(lockedUntil)
  }

  // An expired lock means the counter starts over. Matching on the exact
  // lock value means only one of several simultaneous requests resets it,
  // so a reset can't wipe out a wrong attempt counted in the meantime.
  if (lockedUntil) {
    await prisma.user.updateMany({
      where: { id: session.user.id, passwordChangeLockedUntil: lockedUntil },
      data: { passwordChangeFailedAttempts: 0, passwordChangeLockedUntil: null },
    })
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

  // Only a wrong current password counts toward the limit. The increment is
  // a single atomic update, so simultaneous requests can't both read the
  // same count and slip past the limit. 400 rather than 401 so the client
  // doesn't read a wrong current password as an expired session.
  const currentMatches = await bcrypt.compare(currentPassword, user.password)
  if (!currentMatches) {
    const { passwordChangeFailedAttempts: attempts } = await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordChangeFailedAttempts: { increment: 1 } },
      select: { passwordChangeFailedAttempts: true },
    })

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const newLock = new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
      await prisma.user.update({
        where: { id: session.user.id },
        data: { passwordChangeFailedAttempts: 0, passwordChangeLockedUntil: newLock },
      })
      return lockedResponse(newLock)
    }

    const remaining = MAX_FAILED_ATTEMPTS - attempts
    return NextResponse.json(
      {
        error: `Current password is incorrect. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining.`,
      },
      { status: 400 }
    )
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    )
  }

  // Applies to the new password only. Existing accounts may already have a
  // longer current password and must still be able to change it.
  if (passwordByteLength(newPassword) > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { error: "Password is too long. Use 72 characters or fewer." },
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

  // Saving the password and clearing the rate limit in one update, so a
  // successful change always starts the counter over
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      password: hashedPassword,
      passwordChangeFailedAttempts: 0,
      passwordChangeLockedUntil: null,
    },
  })

  return NextResponse.json({ ok: true })
}
