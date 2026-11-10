import { test } from "node:test"
import assert from "node:assert/strict"
import {
  defaultOpportunityTeam,
  DEFAULT_TICKET_QUEUE_OFF_CODE,
  LAST_TEAM_FOR_MODULE_CODE,
  moduleOffRefusal,
  modulesTurnedOff,
  openRecordsNote,
  readModuleFlags,
  teamsForModule,
  teamUsesModule,
} from "./team-modules"
import { teamChoices } from "./opportunity-view"
import { defaultNewTicketTeamId, ticketTeamChoices } from "./ticket-view"
import { defaultNewOpportunityTeamId } from "./team-rules"

// Which teams tickets and opportunities use (src/lib/team-modules.ts) and
// the pickers that follow it. Run with npm test.

const team = (id: string, extra: Partial<{ isDefault: boolean; isMember: boolean; sortOrder: number; usesTickets: boolean; usesOpportunities: boolean }> = {}) => ({
  id,
  isDefault: false,
  isMember: true,
  sortOrder: 0,
  usesTickets: true,
  usesOpportunities: true,
  ...extra,
})

const ids = (list: readonly { id: string }[]) => list.map((t) => t.id)

// ─── Flags ──────────────────────────────────────────────────────────────────

test("a team uses a module unless its flag is false (missing counts as on)", () => {
  assert.equal(teamUsesModule({}, "tickets"), true)
  assert.equal(teamUsesModule({ usesTickets: false }, "tickets"), false)
  assert.equal(teamUsesModule({ usesTickets: false }, "opportunities"), true)
  assert.equal(teamUsesModule({ usesOpportunities: false }, "opportunities"), false)
})

// ─── Pickers and the sidebar settings exclude off teams ─────────────────────

test("a module's team list leaves out teams that are off, but keeps a record's current team", () => {
  const teams = [team("a"), team("off", { usesTickets: false }), team("b")]
  assert.deepEqual(ids(teamsForModule(teams, "tickets")), ["a", "b"])
  assert.deepEqual(ids(teamsForModule(teams, "opportunities")), ["a", "off", "b"])
  // The record page keeps showing the team a ticket is already on
  assert.deepEqual(ids(teamsForModule(teams, "tickets", "off")), ["a", "off", "b"])
})

test("opportunity team picker: off teams are hidden, the current one is kept", () => {
  const teams = [team("general", { isDefault: true }), team("sales"), team("support", { usesOpportunities: false })]
  assert.deepEqual(ids(teamChoices(teams, true, { includeDefault: true })), ["general", "sales"])
  assert.deepEqual(ids(teamChoices(teams, true, { keepId: "support" })), ["general", "sales", "support"])
})

test("ticket queue picker: off teams are hidden even for dispatchers, the current one is kept", () => {
  const teams = [team("helpdesk"), team("sales", { usesTickets: false })]
  assert.deepEqual(ids(ticketTeamChoices(teams, { canAssign: true, canViewAll: true })), ["helpdesk"])
  assert.deepEqual(ids(ticketTeamChoices(teams, { canAssign: true, canViewAll: true, keepId: "sales" })), ["helpdesk", "sales"])
})

test("new ticket starts on a queue that uses tickets", () => {
  const teams = [team("sales", { usesTickets: false, sortOrder: 0 }), team("helpdesk", { sortOrder: 1 })]
  assert.equal(defaultNewTicketTeamId(teams, "helpdesk", { canAssign: false, canViewAll: false }), "helpdesk")
  // With no usable default, the user's first team that uses tickets
  assert.equal(defaultNewTicketTeamId(teams, null, { canAssign: false, canViewAll: false }), "helpdesk")
})

test("new opportunity starts on a team that uses opportunities", () => {
  const general = team("general", { isDefault: true, sortOrder: 0, usesOpportunities: false })
  const sales = team("sales", { sortOrder: 1 })
  assert.equal(defaultNewOpportunityTeamId([general, sales], true), "sales")
  assert.equal(defaultNewOpportunityTeamId([team("general", { isDefault: true }), sales], true), "general")
})

test("the default opportunity team: General while it uses opportunities, else the first that does", () => {
  const general = team("general", { isDefault: true })
  assert.equal(defaultOpportunityTeam([general, team("sales")])?.id, "general")
  assert.equal(defaultOpportunityTeam([{ ...general, usesOpportunities: false }, team("sales"), team("ops")])?.id, "sales")
})

// ─── Turning a module off ───────────────────────────────────────────────────

test("the last team using a module can't be turned off for it", () => {
  const teams = [team("a"), team("b", { usesTickets: false })]
  assert.equal(moduleOffRefusal("a", "tickets", teams, null)?.code, LAST_TEAM_FOR_MODULE_CODE)
  assert.equal(moduleOffRefusal("a", "opportunities", teams, null), null)
  assert.equal(moduleOffRefusal("b", "opportunities", teams, null), null)
})

test("the default ticket queue can't be turned off for tickets", () => {
  const teams = [team("helpdesk"), team("alerts")]
  assert.equal(moduleOffRefusal("helpdesk", "tickets", teams, "helpdesk")?.code, DEFAULT_TICKET_QUEUE_OFF_CODE)
  assert.equal(moduleOffRefusal("alerts", "tickets", teams, "helpdesk"), null)
  // Opportunities don't care about the ticket queue
  assert.equal(moduleOffRefusal("helpdesk", "opportunities", teams, "helpdesk"), null)
})

test("only a change from on to off counts as turning off", () => {
  assert.deepEqual(modulesTurnedOff({ usesTickets: true, usesOpportunities: true }, { usesTickets: false }), ["tickets"])
  assert.deepEqual(modulesTurnedOff({ usesTickets: false }, { usesTickets: false }), [])
  assert.deepEqual(modulesTurnedOff({}, { usesTickets: true, usesOpportunities: false }), ["opportunities"])
})

// ─── Existing records stay visible ──────────────────────────────────────────

test("turning off says how many open records stay on the team, without blocking", () => {
  assert.match(openRecordsNote(3, "tickets"), /^3 open tickets are still on this team\. They keep this team and still show under All tickets/)
  assert.match(openRecordsNote(1, "opportunities"), /^1 open opportunity is still on this team\. It keeps this team and still shows under All opportunities/)
  assert.equal(openRecordsNote(0, "tickets"), "No open tickets are on this team.")
})

// ─── Request bodies ─────────────────────────────────────────────────────────

test("the flags must be true or false; left out is kept", () => {
  assert.deepEqual(readModuleFlags({}), { data: {} })
  assert.deepEqual(readModuleFlags({ usesTickets: false, usesOpportunities: true }), { data: { usesTickets: false, usesOpportunities: true } })
  assert.equal(readModuleFlags({ usesTickets: "no" }).error, "Use for tickets must be true or false")
  assert.equal(readModuleFlags({ usesOpportunities: null }).error, "Use for opportunities must be true or false")
})
