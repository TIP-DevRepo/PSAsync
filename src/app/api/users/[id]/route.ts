import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"
import { getUserRank } from "@/lib/permissions"
import {
  readRoleIdsFromBody,
  loadRolesForAssignment,
  setUserRoles,
  assignsRoleAtOrAboveRank,
  ROLE_AT_OR_ABOVE_RANK_MESSAGE,
} from "@/lib/user-roles"
import { ensureEveryoneRole } from "@/lib/everyone-role"
import { effectiveRoles, rankOf } from "@/lib/team-roles"

const targetRoleFields = { id: true, rank: true, isGlobalAdmin: true, isEveryone: true } as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.users",
    message: "You do not have permission to edit users",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId
  const body = await req.json()
  const { active } = body
  // roleIds replaces the user's full set of roles. The existing single role
  // dropdown still sends roleId, which is mapped to a one item list.
  const roleIds = readRoleIdsFromBody(body)
  if (roleIds === null) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }
  if (active !== undefined && typeof active !== "boolean") {
    return NextResponse.json({ error: "Invalid active value" }, { status: 400 })
  }

  // Deactivating yourself would sign you out with no way back in, so it's
  // refused outright, before any of the rank rules below
  if (id === ctx.userId && active === false) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 403 })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id, companyId },
    select: {
      id: true,
      active: true,
      userRoles: {
        where: { role: { isEveryone: false } },
        select: { role: { select: targetRoleFields } },
      },
      // Team default roles count toward the user's rank, as everywhere else
      teamMemberships: {
        where: { team: { companyId } },
        select: { team: { select: { id: true, defaultRoles: { select: { role: { select: targetRoleFields } } } } } },
      },
    },
  })
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Hierarchy: you can only change the roles of, or activate/deactivate, a
  // user whose highest role (direct or from a team) is below your own, and you can't
  // hand out a role at or above your own rank either, otherwise this would
  // let someone edit their way around the same protection.
  const actorRank = await getUserRank(ctx.userId)
  const targetRank = rankOf(effectiveRoles(targetUser.userRoles.map((ur) => ur.role), targetUser.teamMemberships))

  if (roleIds !== undefined && targetRank >= actorRank) {
    return NextResponse.json(
      { error: "You can only change roles for users below you in the hierarchy" },
      { status: 403 }
    )
  }
  if (active !== undefined && targetRank >= actorRank) {
    return NextResponse.json(
      { error: "You can only activate or deactivate users below you in the hierarchy" },
      { status: 403 }
    )
  }

  let newRoles: { isGlobalAdmin: boolean }[] | undefined
  if (roleIds !== undefined) {
    // Confirms every role belongs to this company and isn't Everyone
    const loaded = await loadRolesForAssignment(prisma, companyId, roleIds)
    if (loaded.error !== undefined) {
      return NextResponse.json({ error: loaded.error }, { status: 400 })
    }
    if (assignsRoleAtOrAboveRank(loaded.roles, actorRank)) {
      return NextResponse.json({ error: ROLE_AT_OR_ABOVE_RANK_MESSAGE }, { status: 403 })
    }
    newRoles = loaded.roles
  }

  // A company must never be left without an active Global Admin. If this
  // change would take the target from an active Global Admin to not one
  // (by removing the role or deactivating them), at least one other active
  // user must still hold Global Admin. Checked inside the same transaction
  // as the write to keep the window for two concurrent demotions small.
  const wasActiveGlobalAdmin = targetUser.active && targetUser.userRoles.some((ur) => ur.role.isGlobalAdmin)
  const willBeGlobalAdmin = newRoles ? newRoles.some((r) => r.isGlobalAdmin) : !!wasActiveGlobalAdmin
  const willBeActive = active !== undefined ? active : targetUser.active
  const losesGlobalAdmin = wasActiveGlobalAdmin && !(willBeGlobalAdmin && willBeActive)

  // Every company keeps its one Everyone role. GET /api/roles no longer
  // creates a missing one, so role assignment does, outside the
  // transaction so a lost creation race can't abort it.
  if (roleIds !== undefined) await ensureEveryoneRole(prisma, companyId)

  const result = await prisma.$transaction(async (tx) => {
    if (losesGlobalAdmin) {
      const otherGlobalAdmins = await tx.user.count({
        where: {
          companyId,
          active: true,
          id: { not: id },
          userRoles: { some: { role: { isGlobalAdmin: true } } },
        },
      })
      if (otherGlobalAdmins === 0) return { lastGlobalAdmin: true as const }
    }

    if (active !== undefined) {
      await tx.user.update({ where: { id, companyId }, data: { active } })
    }
    if (roleIds !== undefined) {
      // Also keeps the legacy roleId in sync with the highest of these roles
      await setUserRoles(tx, id, roleIds)
    }

    return {
      user: await tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          active: true,
          userRoles: {
            where: { role: { isEveryone: false } },
            select: { role: true },
            orderBy: { role: { rank: "desc" } },
          },
        },
      }),
    }
  })

  if ("lastGlobalAdmin" in result) {
    return NextResponse.json(
      { error: "This is the last active Global Admin. Give another active user the Global Admin role first." },
      { status: 400 }
    )
  }

  const roles = result.user.userRoles.map((ur) => ur.role)
  return NextResponse.json({ id: result.user.id, role: roles[0] ?? null, roles, active: result.user.active })
}
