import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission, getUserRank } from "@/lib/permissions"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to edit users" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { roleId, active } = body

  if (roleId !== undefined) {
    const targetUser = await prisma.user.findUnique({
      where: { id, companyId: session.user.companyId },
      include: { role: true },
    })
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // If a roleId was sent, confirm it actually belongs to this company
    // before assigning it, this prevents assigning a role from another company
    let newRole = null
    if (roleId) {
      newRole = await prisma.role.findUnique({ where: { id: roleId } })
      if (!newRole || newRole.companyId !== session.user.companyId) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 })
      }
    }

    // Hierarchy: you can only change the role of a user whose current role
    // is below your own, and you can't hand out a role at or above your
    // own rank either, otherwise this would let someone edit their way
    // around the same protection.
    const actorRank = await getUserRank(session.user.id)
    const currentRoleRank = targetUser.role?.rank ?? 0
    if (currentRoleRank >= actorRank) {
      return NextResponse.json(
        { error: "You can only change roles for users below you in the hierarchy" },
        { status: 403 }
      )
    }
    if (newRole && newRole.rank >= actorRank) {
      return NextResponse.json(
        { error: "You can't assign a role at or above your own rank" },
        { status: 403 }
      )
    }
  }

  const updated = await prisma.user.update({
    where: { id, companyId: session.user.companyId },
    data: {
      ...(roleId !== undefined ? { roleId } : {}),
      ...(active !== undefined ? { active } : {}),
    },
    include: { role: true },
  })

  return NextResponse.json({ id: updated.id, role: updated.role, active: updated.active })
}