// Server side only (it reads the database). Loading and saving sidebar
// layouts for the routes and the dashboard layout; the rules themselves are
// in src/lib/sidebar-layout.ts and the zod schemas in
// src/lib/sidebar-layout-schema.ts.
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { keepKnownTeams, layoutTeamIds, type SidebarLayout } from "@/lib/sidebar-layout"
import { TEAM_ORDER } from "@/lib/team-selects"

export const COMPANY_SIDEBAR_SELECT = { sidebarLayout: true, allowUserSidebar: true } as const

// A missing settings row means the default: users may customise
export function allowsUserSidebar(settings: { allowUserSidebar?: boolean | null } | null | undefined): boolean {
  return settings?.allowUserSidebar !== false
}

// A layout as the Json column takes it (undefined parts left out)
export function sidebarLayoutJson(layout: SidebarLayout): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(layout)) as Prisma.InputJsonValue
}

// The column's "no layout" value
export const NO_SIDEBAR_LAYOUT = Prisma.DbNull

// Drops every team id the layout names that isn't a team of the company, in
// one query, so a stored layout only ever holds the company's own teams.
// A team id is only ever used to order the folder, never to read a team,
// so a foreign or made up one is dropped rather than refused, like an
// unknown page.
export async function keepCompanyTeams(companyId: string, layout: SidebarLayout): Promise<SidebarLayout> {
  const ids = layoutTeamIds(layout)
  if (ids.length === 0) return layout
  const teams = await prisma.team.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } })
  return keepKnownTeams(layout, new Set(teams.map((t) => t.id)))
}

// The company's teams for the Settings > Sidebar editor, in their own order
export function loadCompanyTeamsForSidebar(companyId: string) {
  return prisma.team.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: TEAM_ORDER })
}
