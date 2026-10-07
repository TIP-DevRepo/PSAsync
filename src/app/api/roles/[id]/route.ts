import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission, getUserRank, type RolePermissions } from "@/lib/permissions"
import { syncLegacyRoleId } from "@/lib/user-roles"
import { readRoleColor } from "@/lib/role-colors"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to edit roles" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.role.findUnique({ where: { id } })
  if (!existing || existing.companyId !== session.user.companyId) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 })
  }

  if (existing.isGlobalAdmin) {
    return NextResponse.json({ error: "The Global Admin role cannot be modified" }, { status: 403 })
  }

  // Hierarchy: you can only edit roles ranked below your own, and can't
  // raise a role's rank to your own level or above.
  const actorRank = await getUserRank(session.user.id)
  if (existing.rank >= actorRank) {
    return NextResponse.json(
      { error: "You can only edit roles below your own in the hierarchy" },
      { status: 403 }
    )
  }

  const body = await req.json()

  // Rank is only ever changed by dragging roles into order (PUT
  // /api/roles/order), which renumbers the whole company at once
  if (body.rank !== undefined && Number(body.rank) !== existing.rank) {
    return NextResponse.json(
      { error: "A role's rank is set by dragging it into order in Roles & Permissions" },
      { status: 400 }
    )
  }

  const color = readRoleColor(body.color)
  if (color === false) {
    return NextResponse.json({ error: "Color must be a hex value like #3B82F6" }, { status: 400 })
  }

  // The Everyone role's name and color are fixed (it is always "Everyone"
  // in neutral gray), only its permissions can change. An unchanged name
  // sent back by the panel is fine, only an actual change is rejected.
  if (existing.isEveryone) {
    const renaming = body.name !== undefined && body.name.trim() !== existing.name
    const recoloring = color !== undefined && color !== existing.color
    if (renaming || recoloring) {
      return NextResponse.json(
        { error: "The Everyone role's name and color can't be changed, only its permissions" },
        { status: 403 }
      )
    }
  }

  // If this edit would remove Settings > Users access from this role, make
  // sure at least one OTHER role in the company still has it — otherwise
  // nobody could ever manage roles/users again
  if (body.permissions !== undefined) {
    const willHaveUsersAccess = !!body.permissions?.settingsSections?.users
    const hadUsersAccess = !!(existing.permissions as RolePermissions)?.settingsSections?.users
    if (hadUsersAccess && !willHaveUsersAccess) {
      const otherRolesWithAccess = await prisma.role.findMany({
        where: { companyId: session.user.companyId, id: { not: id } },
      })
      const stillCovered = otherRolesWithAccess.some(
        (r) => !!(r.permissions as RolePermissions)?.settingsSections?.users
      )
      if (!stillCovered) {
        return NextResponse.json(
          { error: "Can't remove Users & Roles access — this is the only role that has it. At least one role must be able to manage users." },
          { status: 400 }
        )
      }
    }
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined && !existing.isEveryone) data.name = body.name.trim()
  if (color !== undefined && !existing.isEveryone) data.color = color
  if (body.permissions !== undefined) data.permissions = body.permissions

  const role = await prisma.role.update({ where: { id }, data })

  return NextResponse.json(role)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to delete roles" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.role.findUnique({ where: { id } })
  if (!existing || existing.companyId !== session.user.companyId) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 })
  }

  if (existing.isGlobalAdmin) {
    return NextResponse.json({ error: "The Global Admin role cannot be deleted" }, { status: 403 })
  }

  if (existing.isEveryone) {
    return NextResponse.json({ error: "The Everyone role cannot be deleted" }, { status: 403 })
  }

  const actorRank = await getUserRank(session.user.id)
  if (existing.rank >= actorRank) {
    return NextResponse.json(
      { error: "You can only delete roles below your own in the hierarchy" },
      { status: 403 }
    )
  }

  // Approval workflows require a role (required column, ON DELETE
  // RESTRICT), so deleting one a workflow uses would fail at the database.
  // Block with the workflow names instead, since quietly deleting or
  // rewriting approval rules isn't something a role delete should do.
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { requiredRoleId: id },
    select: { name: true },
    orderBy: { name: "asc" },
  })
  if (workflows.length > 0) {
    return NextResponse.json(
      {
        error: `This role is required by ${workflows.length === 1 ? "an approval workflow" : "approval workflows"}: ${workflows
          .map((w) => w.name)
          .join(", ")}. Change or delete ${workflows.length === 1 ? "that workflow" : "those workflows"} first.`,
      },
      { status: 400 }
    )
  }

  // Don't allow deleting the last role that can manage Users & Roles —
  // that would permanently lock everyone out of ever fixing this
  const permissions = existing.permissions as RolePermissions
  if (permissions?.settingsSections?.users) {
    const otherRoles = await prisma.role.findMany({
      where: { companyId: session.user.companyId, id: { not: id } },
    })
    const stillCovered = otherRoles.some(
      (r) => !!(r.permissions as RolePermissions)?.settingsSections?.users
    )
    if (!stillCovered) {
      return NextResponse.json(
        { error: "Can't delete this role — it's the only one that can manage Users & Roles." },
        { status: 400 }
      )
    }
  }

  const affectedUsers = await prisma.$transaction(async (tx) => {
    // Everyone who held this role, through UserRole or the legacy column
    const holders = await tx.user.findMany({
      where: { OR: [{ userRoles: { some: { roleId: id } } }, { roleId: id }] },
      select: { id: true },
    })

    // Sales order status notification rules that point at this role would
    // be left targeting nothing, so clear just those statuses
    const settings = await tx.companySettings.findUnique({
      where: { companyId: session.user.companyId },
      select: { id: true, soStatusNotifyRules: true },
    })
    const rules = settings?.soStatusNotifyRules as Record<string, { type: string; id: string } | null> | null | undefined
    if (settings && rules && typeof rules === "object") {
      let cleared = false
      const nextRules: Record<string, { type: string; id: string } | null> = {}
      for (const [status, rule] of Object.entries(rules)) {
        if (rule?.type === "role" && rule.id === id) {
          nextRules[status] = null
          cleared = true
        } else {
          nextRules[status] = rule
        }
      }
      if (cleared) {
        await tx.companySettings.update({ where: { id: settings.id }, data: { soStatusNotifyRules: nextRules } })
      }
    }

    // UserRole rows cascade, the legacy User.roleId is set null by its FK,
    // then each former holder's legacy roleId is re-pointed at whatever
    // their highest remaining role is
    await tx.role.delete({ where: { id } })
    await syncLegacyRoleId(tx, holders.map((h) => h.id))

    return holders.length
  })

  return NextResponse.json({ deleted: true, affectedUsers })
}