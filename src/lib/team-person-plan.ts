import type { NextResponse } from "next/server"
import { apiError, type AccessContext } from "@/lib/api-access"
import { assertRefs, loadTeamMemberIds } from "@/lib/scoped-loaders"
import { readOptionalId } from "@/lib/opportunity-rules"
import { teamModuleRefusal } from "@/lib/team-module-checks"
import type { TeamModule } from "@/lib/team-modules"

// The team and person rules a record's PATCH shares, for opportunities (the
// owner) and tickets (the assignee): a new team must be the company's and
// one the user may use, a named person follows the record's assign rule
// and must be a member of the team (new or kept), and a team change whose
// person isn't in the new team needs a new person or unassigned in the
// same request. A new team must also use the record's module (tickets or
// opportunities, src/lib/team-modules.ts); a record already on a team that
// is off keeps it. Only a team or person change is checked against the team,
// so an older record whose person isn't in its team keeps saving its
// other fields.

const isBlank = (value: unknown) => value === undefined || value === null || value === ""

export interface TeamPersonRules {
  // The body key of the person: ownerId or assigneeId
  personKey: "ownerId" | "assigneeId"
  // The module a new team must be used for
  module: TeamModule
  mayUseTeam: (actorInTeam: boolean) => boolean
  mayAssign: (personId: string | null, actorInTeam: boolean) => boolean
  messages: {
    // 403 when the user may not use the new team
    teamNotMember: string
    // 403 when the user may not make this person the record's
    assignNotAllowed: string
    // 400 when the named person isn't in the team
    personNotInTeam: string
    // 400 when a team change keeps a person who isn't in the new team
    teamChangePerson: string
  }
  personNotInTeamCode: string
}

export type TeamPersonPlan =
  | { response: NextResponse }
  | {
      response?: undefined
      // The new team, when the body changes it
      teamChange: string | null
      // Whether the body names the person (null is unassigned)
      personGiven: boolean
      personId: string | null
      // Checks the person is in the team. Runs after the record's other ids
      // pass assertRefs, so a bad id is reported as that id first.
      checkMembership: () => NextResponse | null
    }

export async function planTeamPerson(
  ctx: AccessContext,
  existing: { teamId: string | null; personId: string | null },
  body: Record<string, unknown>,
  rules: TeamPersonRules
): Promise<TeamPersonPlan> {
  // A new team must be the company's. It can't be cleared.
  let teamChange: string | null = null
  if ("teamId" in body) {
    if (isBlank(body.teamId)) return { response: apiError(400, "A team is required") }
    if (typeof body.teamId !== "string") return { response: apiError(400, "Invalid team", "INVALID_REFERENCE") }
    const invalidTeam = await assertRefs(ctx, { teamId: body.teamId })
    if (invalidTeam) return { response: invalidTeam }
    if (body.teamId !== existing.teamId) teamChange = body.teamId
  }
  if (teamChange) {
    const offTeam = await teamModuleRefusal(ctx, teamChange, rules.module)
    if (offTeam) return { response: offTeam }
  }

  // Null or blank unassigns
  const personGiven = rules.personKey in body
  let personId = existing.personId
  if (personGiven) {
    const person = readOptionalId(body[rules.personKey])
    if (person.error !== undefined) return { response: apiError(400, "Invalid user", "INVALID_REFERENCE") }
    personId = person.value
  }

  const teamId = teamChange ?? existing.teamId
  let members = new Set<string>()
  if ((teamChange || personGiven) && teamId) {
    members = await loadTeamMemberIds(ctx, teamId, [ctx.userId, personId])
    const actorInTeam = members.has(ctx.userId)
    if (teamChange && !rules.mayUseTeam(actorInTeam)) return { response: apiError(403, rules.messages.teamNotMember, "FORBIDDEN") }
    if (personGiven && !rules.mayAssign(personId, actorInTeam)) return { response: apiError(403, rules.messages.assignNotAllowed, "FORBIDDEN") }
  }

  return {
    teamChange,
    personGiven,
    personId,
    checkMembership: () => {
      if (!(teamChange || personGiven) || !personId || members.has(personId)) return null
      const message = teamChange && !personGiven ? rules.messages.teamChangePerson : rules.messages.personNotInTeam
      return apiError(400, message, rules.personNotInTeamCode)
    },
  }
}
