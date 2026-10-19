import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { getUserRank } from "@/lib/permissions"
import { requireAccess } from "@/lib/api-access"
import {
  readRoleIdsFromBody,
  loadRolesForAssignment,
  setUserRoles,
  assignsRoleAtOrAboveRank,
  ROLE_AT_OR_ABOVE_RANK_MESSAGE,
} from "@/lib/user-roles"
import { ensureEveryoneRole } from "@/lib/everyone-role"
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordByteLength } from "@/lib/password-rules"
import { usesMicrosoftSso } from "@/lib/sso-account"

// The one answer for an invite email that can't be used, except one that
// already belongs to a user in the inviter's own company
const EMAIL_NOT_USABLE_MESSAGE = "This email cannot be used"
const INVITE_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Any active user, since pickers on other pages (quote assign, inventory
// checkout, approval workflows, SO notify rules) list users by name. Email
// addresses only go to users who manage users.
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const showContact = ctx.can("settingsSections.users")

  const users = await prisma.user.findMany({
    where: { companyId: ctx.companyId },
    select: {
      id: true,
      name: true,
      email: showContact,
      active: true,
      createdAt: true,
      loginLockedUntil: true,
      userRoles: {
        where: { role: { isEveryone: false } },
        select: { role: { select: { id: true, name: true, rank: true, color: true, isGlobalAdmin: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  // Only a Global Admin can unlock a login, so only they are told who is
  // locked. The attempt counter itself is never sent to anyone.
  const showLocks = ctx.access.isGlobalAdmin
  const now = Date.now()

  // roles is every role the user holds (highest rank first), with the rank
  // and color Manage Users needs for its pills and hierarchy locks. role is
  // the highest of them.
  return NextResponse.json(
    users.map(({ userRoles, loginLockedUntil, ...user }) => {
      const roles = userRoles.map((ur) => ur.role).sort((a, b) => b.rank - a.rank)
      if (!showLocks) return { ...user, role: roles[0] ?? null, roles }
      const lockedUntil = loginLockedUntil && loginLockedUntil.getTime() > now ? loginLockedUntil : null
      return { ...user, role: roles[0] ?? null, roles, loginLockedUntil: lockedUntil }
    })
  )
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.users",
    message: "You do not have permission to invite users",
  })
  if (response) return response

  const body = await req.json()
  const { name, email } = body
  const tempPassword = typeof body.tempPassword === "string" ? body.tempPassword : ""

  // Same rules as choosing a password on My Account, checked here and not
  // just in the browser. The password itself is never echoed back.
  if (!tempPassword) {
    return NextResponse.json({ error: "Temporary password is required" }, { status: 400 })
  }
  if (tempPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Temporary password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    )
  }
  if (passwordByteLength(tempPassword) > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { error: `Temporary password is too long. Use ${MAX_PASSWORD_BYTES} characters or fewer.` },
      { status: 400 }
    )
  }
  // Accepts roleIds (a list) or the existing single roleId field
  const requestedRoleIds = readRoleIdsFromBody(body)
  if (requestedRoleIds === null) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }
  const roleIds = requestedRoleIds ?? []

  // Emails are unique across every company. One already used in this
  // company says so; every other reason an email can't be used (another
  // company has it, or it isn't an email at all) gets the same generic
  // answer, so an invite never reveals who uses PSAsync elsewhere.
  if (typeof email !== "string" || !INVITE_EMAIL_SHAPE.test(email)) {
    return NextResponse.json({ error: EMAIL_NOT_USABLE_MESSAGE }, { status: 400 })
  }
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { companyId: true },
  })
  if (existing) {
    const error = existing.companyId === ctx.companyId ? "A user with that email already exists" : EMAIL_NOT_USABLE_MESSAGE
    return NextResponse.json({ error }, { status: 400 })
  }

  const loaded = await loadRolesForAssignment(prisma, ctx.companyId, roleIds)
  if (loaded.error !== undefined) {
    return NextResponse.json({ error: loaded.error }, { status: 400 })
  }

  // The same rank rule as changing an existing user's roles: only roles
  // below your own rank, otherwise inviting a fresh user would sidestep it
  if (loaded.roles.length > 0) {
    const actorRank = await getUserRank(ctx.userId)
    if (assignsRoleAtOrAboveRank(loaded.roles, actorRank)) {
      return NextResponse.json({ error: ROLE_AT_OR_ABOVE_RANK_MESSAGE }, { status: 403 })
    }
  }

  // Every company keeps its one Everyone role. GET /api/roles no longer
  // creates a missing one, so inviting does, outside the transaction so a
  // lost creation race can't abort it.
  await ensureEveryoneRole(prisma, ctx.companyId)

  const hashedPassword = await bcrypt.hash(tempPassword, 10)

  // A company that signs in with Microsoft never uses this password, so
  // only password companies make the new user replace it on first sign in
  const company = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: { settings: { select: { ssoEnabled: true } } },
  })

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId: ctx.companyId,
        name,
        email,
        password: hashedPassword,
        mustChangePassword: !usesMicrosoftSso(company?.settings),
      },
    })
    // Also sets the legacy roleId to the highest of these roles
    await setUserRoles(tx, created.id, roleIds)
    return created
  })

  return NextResponse.json({ id: user.id, name: user.name, email: user.email })
}