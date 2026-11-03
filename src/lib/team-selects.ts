import type { Prisma } from "@/generated/prisma"

// What the Teams routes read and return. Users are names only, never email
// addresses; roles carry what a role pill needs.

export const TEAM_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] satisfies Prisma.TeamOrderByWithRelationInput[]

const roleFields = { id: true, name: true, rank: true, color: true, isGlobalAdmin: true } as const

export const teamSelect = {
  id: true,
  name: true,
  description: true,
  isDefault: true,
  sortOrder: true,
  members: {
    select: { user: { select: { id: true, name: true, active: true } } },
    orderBy: { user: { name: "asc" } },
  },
  // permissions only for the grant rule; toTeamResponse never returns them
  defaultRoles: { select: { role: { select: { ...roleFields, permissions: true } } }, orderBy: { role: { rank: "desc" } } },
} satisfies Prisma.TeamSelect

export type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>
