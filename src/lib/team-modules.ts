// Which teams a module (tickets, opportunities) uses: Team.usesTickets and
// Team.usesOpportunities, both on by default. A team that is off for a
// module is left out of that module's sidebar folder and every team picker
// for it, and the server refuses to put a new or moved record on it.
// Records already on it keep it, show under All tickets or All
// opportunities, and still show their team. No React and no database
// imports, so the routes and the screens share one set of rules.

export type TeamModule = "tickets" | "opportunities"

export const TEAM_MODULES: readonly TeamModule[] = ["tickets", "opportunities"]

export const TEAM_MODULE_FIELD = {
  tickets: "usesTickets",
  opportunities: "usesOpportunities",
} as const satisfies Record<TeamModule, string>

export type TeamModuleFlags = { usesTickets?: boolean | null; usesOpportunities?: boolean | null }

// A missing flag (an older response) counts as on, like the column default
export function teamUsesModule(team: TeamModuleFlags, module: TeamModule): boolean {
  return team[TEAM_MODULE_FIELD[module]] !== false
}

// The teams a module's picker offers: those that use it, plus keepId (a
// record's current team stays listed so the field shows it)
export function teamsForModule<T extends { id: string } & TeamModuleFlags>(teams: readonly T[], module: TeamModule, keepId?: string | null): T[] {
  return teams.filter((t) => teamUsesModule(t, module) || t.id === keepId)
}

export const TEAM_NOT_FOR_MODULE_CODE = "TEAM_NOT_FOR_MODULE"

// 400 when a new or moved record names a team that is off for its module
export function teamNotForModuleMessage(module: TeamModule): string {
  return module === "tickets"
    ? "This team isn't used for tickets. Choose another queue, or turn on Use for tickets for this team in Settings > Teams."
    : "This team isn't used for opportunities. Choose another team, or turn on Use for opportunities for this team in Settings > Teams."
}

// Every ticket and every opportunity needs a team, so the last team that
// uses a module can't be turned off for it (409)
export const LAST_TEAM_FOR_MODULE_CODE = "LAST_TEAM_FOR_MODULE"
export function lastTeamForModuleMessage(module: TeamModule): string {
  return module === "tickets"
    ? "At least one team must be used for tickets. Turn on Use for tickets for another team first."
    : "At least one team must be used for opportunities. Turn on Use for opportunities for another team first."
}

// New tickets with no queue go to the default ticket team (Ticket
// Settings), so it can't be turned off for tickets (409)
export const DEFAULT_TICKET_QUEUE_OFF_CODE = "DEFAULT_TICKET_QUEUE"
export const DEFAULT_TICKET_QUEUE_OFF_MESSAGE =
  "This team is the default queue for new tickets. Choose another default queue in Ticket Settings before turning tickets off for it."

// Shown before turning a team off for a module: what happens to the open
// records still on it. Never blocks the change.
export function openRecordsNote(count: number, module: TeamModule): string {
  const noun = module === "tickets" ? (count === 1 ? "open ticket" : "open tickets") : count === 1 ? "open opportunity" : "open opportunities"
  const all = module === "tickets" ? "All tickets" : "All opportunities"
  if (count === 0) return `No ${module === "tickets" ? "open tickets" : "open opportunities"} are on this team.`
  return `${count} ${noun} ${count === 1 ? "is" : "are"} still on this team. ${count === 1 ? "It keeps" : "They keep"} this team and still ${count === 1 ? "shows" : "show"} under ${all}, but no new or moved ${module} can use it.`
}

// Why turning a module off for a team is refused, or null when it may go
// ahead: the last team using the module, or the default ticket queue.
// `teams` is every team of the company with its flags.
export function moduleOffRefusal(
  teamId: string,
  module: TeamModule,
  teams: readonly ({ id: string } & TeamModuleFlags)[],
  defaultTicketTeamId: string | null
): { message: string; code: string } | null {
  if (module === "tickets" && teamId === defaultTicketTeamId) return { message: DEFAULT_TICKET_QUEUE_OFF_MESSAGE, code: DEFAULT_TICKET_QUEUE_OFF_CODE }
  const othersUsing = teams.some((t) => t.id !== teamId && teamUsesModule(t, module))
  if (!othersUsing) return { message: lastTeamForModuleMessage(module), code: LAST_TEAM_FOR_MODULE_CODE }
  return null
}

// The team new opportunities go to when none is chosen: General while it
// uses opportunities, otherwise the first team (in the given order) that
// does, otherwise General
export function defaultOpportunityTeam<T extends { id: string; isDefault: boolean } & TeamModuleFlags>(teamsInOrder: readonly T[]): T | null {
  const general = teamsInOrder.find((t) => t.isDefault) ?? null
  if (general && teamUsesModule(general, "opportunities")) return general
  return teamsInOrder.find((t) => teamUsesModule(t, "opportunities")) ?? general
}

export const MODULE_FLAG_MESSAGE = {
  usesTickets: "Use for tickets must be true or false",
  usesOpportunities: "Use for opportunities must be true or false",
} as const

// usesTickets and usesOpportunities from a Teams request body: each left out
// is kept, anything but true or false is refused
export function readModuleFlags(body: Record<string, unknown>): { data: { usesTickets?: boolean; usesOpportunities?: boolean }; error?: undefined } | { error: string } {
  const data: { usesTickets?: boolean; usesOpportunities?: boolean } = {}
  for (const key of ["usesTickets", "usesOpportunities"] as const) {
    if (!(key in body)) continue
    if (typeof body[key] !== "boolean") return { error: MODULE_FLAG_MESSAGE[key] }
    data[key] = body[key]
  }
  return { data }
}

// The modules a change turns off for a team that uses them now
export function modulesTurnedOff(current: TeamModuleFlags, change: { usesTickets?: boolean; usesOpportunities?: boolean }): TeamModule[] {
  return TEAM_MODULES.filter((m) => change[TEAM_MODULE_FIELD[m]] === false && teamUsesModule(current, m))
}
