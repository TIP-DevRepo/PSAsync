import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { hasPermission, getUserRank, getEffectiveAccess } from "@/lib/permissions"
import { readRoleIdsFromBody, loadRolesForAssignment, setUserRoles } from "@/lib/user-roles"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const users = await prisma.user.findMany({
    where: { companyId: session.user.companyId },
    select: {
      id: true,
      name: true,
      email: true,
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
  const access = await getEffectiveAccess(session.user.id)
  const showLocks = !!access?.isGlobalAdmin
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
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to invite users" }, { status: 403 })
  }

  const body = await req.json()
  const { name, email, tempPassword } = body
  // Accepts roleIds (a list) or the existing single roleId field
  const requestedRoleIds = readRoleIdsFromBody(body)
  if (requestedRoleIds === null) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }
  const roleIds = requestedRoleIds ?? []

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 400 })
  }

  const loaded = await loadRolesForAssignment(prisma, session.user.companyId, roleIds)
  if (loaded.error !== undefined) {
    return NextResponse.json({ error: loaded.error }, { status: 400 })
  }

  // You can invite someone into roles at or below your own rank, but not
  // above it, otherwise inviting a fresh user would sidestep the same
  // hierarchy rule that already governs editing an existing one.
  if (loaded.roles.length > 0) {
    const actorRank = await getUserRank(session.user.id)
    if (loaded.roles.some((role) => role.rank > actorRank)) {
      return NextResponse.json(
        { error: "You can't invite a user into a role above your own rank" },
        { status: 403 }
      )
    }
  }

  const hashedPassword = await bcrypt.hash(tempPassword, 10)

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId: session.user.companyId,
        name,
        email,
        password: hashedPassword,
      },
    })
    // Also sets the legacy roleId to the highest of these roles
    await setUserRoles(tx, created.id, roleIds)
    return created
  })

  return NextResponse.json({ id: user.id, name: user.name, email: user.email })
}