import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"
import {
  assertRefs,
  loadClientMainLocationId,
  loadTeamMemberIds,
  mayAssignOpportunityTo,
  mayUseOpportunityTeam,
  opportunityStageWhere,
  opportunityWhere,
  OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE,
  type BodyRefs,
} from "@/lib/scoped-loaders"
import { OWNER_NOT_IN_TEAM_MESSAGE, TEAM_CHANGE_OWNER_MESSAGE, TEAM_NOT_MEMBER_MESSAGE } from "@/lib/team-rules"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { OPPORTUNITY_TITLE_MAX, readDate, readExpectedValue, readOptionalId, readText, stageChangeData } from "@/lib/opportunity-rules"
import { recordTimelineActions } from "@/lib/timeline"
import { opportunityChangeActions, opportunityTimelineSnapshotSelect } from "@/lib/opportunity-timeline"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { opportunityFieldAudits } from "@/lib/opportunity-audit"
import type { TimelineAction } from "@/lib/timeline-actions"
import type { Prisma } from "@/generated/prisma"

// Changing an opportunity's fields, shared by PATCH /api/opportunities/[id]
// and the audit log's undo, so an undo goes through every rule an edit does:
// planOpportunityUpdate checks the body (the owner and team rules, the
// contact and location belonging to the client, stage and type of the
// company) and works out the write; applyOpportunityUpdate saves it with its
// timeline actions and audit entries in the caller's transaction.

const isBlank = (value: unknown) => value === undefined || value === null || value === ""

// What planOpportunityUpdate needs to know about the opportunity as it is
export const opportunityUpdateExistingSelect = {
  id: true,
  clientId: true,
  contactId: true,
  stageId: true,
  teamId: true,
  ownerId: true,
} satisfies Prisma.OpportunitySelect

export type OpportunityUpdateExisting = Prisma.OpportunityGetPayload<{ select: typeof opportunityUpdateExistingSelect }>

export type OpportunityUpdatePlan = { data: Prisma.OpportunityUncheckedUpdateInput; response?: undefined } | { response: NextResponse; data?: undefined }

// Checks the fields the body includes and works out the write. A refusal
// is the response the PATCH answers (400 or 403, with the plain reason).
export async function planOpportunityUpdate(
  ctx: AccessContext,
  existing: OpportunityUpdateExisting,
  body: Record<string, unknown>
): Promise<OpportunityUpdatePlan> {
  const refuse = (response: NextResponse) => ({ response })
  const data: Prisma.OpportunityUncheckedUpdateInput = {}
  const refs: BodyRefs = {}

  if ("title" in body) {
    const title = readText(body.title, { label: "Title", max: OPPORTUNITY_TITLE_MAX, required: true })
    if (title.error !== undefined) return refuse(apiError(400, title.error))
    data.title = title.value as string
  }
  if ("expectedValue" in body) {
    const expectedValue = readExpectedValue(body.expectedValue)
    if (expectedValue.error !== undefined) return refuse(apiError(400, expectedValue.error))
    data.expectedValue = expectedValue.value
  }
  if ("expectedCloseDate" in body) {
    const expectedCloseDate = readDate(body.expectedCloseDate)
    if (expectedCloseDate.error !== undefined) return refuse(apiError(400, expectedCloseDate.error))
    data.expectedCloseDate = expectedCloseDate.value
  }

  // A new team must be the company's, and one the caller belongs to (any
  // team with opportunities.viewAll). It can't be cleared.
  let teamChange: string | null = null
  if ("teamId" in body) {
    if (isBlank(body.teamId)) return refuse(apiError(400, "A team is required"))
    if (typeof body.teamId !== "string") return refuse(apiError(400, "Invalid team", "INVALID_REFERENCE"))
    const invalidTeam = await assertRefs(ctx, { teamId: body.teamId })
    if (invalidTeam) return refuse(invalidTeam)
    if (body.teamId !== existing.teamId) {
      teamChange = body.teamId
      data.teamId = body.teamId
    }
  }

  // Null or blank unassigns. A named owner follows the owner rule
  // (mayAssignOpportunityTo) for the opportunity's team, new or kept, and
  // must be a member of it.
  const ownerGiven = "ownerId" in body
  let ownerId = existing.ownerId
  if (ownerGiven) {
    const owner = readOptionalId(body.ownerId)
    if (owner.error !== undefined) return refuse(apiError(400, "Invalid user", "INVALID_REFERENCE"))
    ownerId = owner.value
    data.ownerId = owner.value
    refs.userId = owner.value
  }
  // Only a team or owner change is checked against the team, so an older
  // opportunity whose owner isn't in its team keeps saving its other fields
  const teamId = teamChange ?? existing.teamId
  let members = new Set<string>()
  if ((teamChange || ownerGiven) && teamId) {
    members = await loadTeamMemberIds(ctx, teamId, [ctx.userId, ownerId])
    const actorInTeam = members.has(ctx.userId)
    if (teamChange && !mayUseOpportunityTeam(ctx, actorInTeam)) {
      return refuse(apiError(403, TEAM_NOT_MEMBER_MESSAGE, "FORBIDDEN"))
    }
    if (ownerGiven && !mayAssignOpportunityTo(ctx, ownerId, actorInTeam)) {
      return refuse(apiError(403, OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE, "FORBIDDEN"))
    }
  }

  // A new client or contact is checked as a pair, so the contact (new or
  // kept) always belongs to the client (new or kept)
  if ("clientId" in body || "contactId" in body) {
    if ("clientId" in body && isBlank(body.clientId)) return refuse(apiError(400, "A client is required"))
    if ("contactId" in body && isBlank(body.contactId)) return refuse(apiError(400, "A contact is required"))
    refs.clientId = "clientId" in body ? body.clientId : existing.clientId
    refs.contactId = "contactId" in body ? body.contactId : existing.contactId
    if ("clientId" in body) data.clientId = body.clientId as string
    if ("contactId" in body) data.contactId = body.contactId as string
  }

  if ("stageId" in body) {
    if (isBlank(body.stageId)) return refuse(apiError(400, "A stage is required"))
    refs.opportunityStageId = body.stageId
  }
  // A location of the opportunity's client (new or kept). Null or blank
  // clears it.
  if ("clientLocationId" in body) {
    const location = readOptionalId(body.clientLocationId)
    if (location.error !== undefined) return refuse(apiError(400, "Invalid location", "INVALID_REFERENCE"))
    data.clientLocationId = location.value
    refs.clientLocationId = location.value
    refs.clientId = "clientId" in body ? body.clientId : existing.clientId
  }

  if ("typeId" in body) {
    const type = readOptionalId(body.typeId)
    if (type.error !== undefined) return refuse(apiError(400, "Invalid opportunity type", "INVALID_REFERENCE"))
    data.typeId = type.value
    refs.opportunityTypeId = type.value
  }

  const invalid = await assertRefs(ctx, refs)
  if (invalid) return refuse(invalid)

  // The owner (new, or kept through a team change) must be in the team. A
  // team change whose owner isn't in the new team needs a new owner or
  // unassigned in the same request.
  if ((teamChange || ownerGiven) && ownerId && !members.has(ownerId)) {
    return refuse(apiError(400, teamChange && !ownerGiven ? TEAM_CHANGE_OWNER_MESSAGE : OWNER_NOT_IN_TEAM_MESSAGE, "OWNER_NOT_IN_TEAM"))
  }

  // A new client without a location takes the new client's main location
  if ("clientId" in body && body.clientId !== existing.clientId && !("clientLocationId" in body)) {
    data.clientLocationId = await loadClientMainLocationId(ctx, body.clientId as string)
  }

  // Moving to another stage stamps stageChangedAt and sets or clears closedAt
  if ("stageId" in body) {
    const stage = await prisma.opportunityStage.findFirst({
      where: opportunityStageWhere(ctx, body.stageId as string),
      select: { id: true, category: true },
    })
    if (!stage) return refuse(apiError(400, "Invalid stage", "INVALID_REFERENCE"))
    Object.assign(data, stageChangeData({ id: existing.stageId }, stage, new Date()))
  }

  return { data }
}

type UpdateDb = Pick<Prisma.TransactionClient, "opportunity" | "timelineEntry" | "auditLogEntry" | "user">
type SavedOpportunity = Prisma.OpportunityGetPayload<{ select: typeof opportunityDetailSelect }>

// Saves a planned write inside the caller's transaction. The before values
// are read again right before the write, and each field that actually
// changed gets one timeline ACTION entry and one audit entry (by default
// field_changed; auditEntries lets the undo write its own). Nothing is
// recorded when nothing changed.
export async function applyOpportunityUpdate(
  tx: UpdateDb,
  ctx: Pick<AccessContext, "companyId" | "userId">,
  opportunityId: string,
  data: Prisma.OpportunityUncheckedUpdateInput,
  auditEntries: (saved: SavedOpportunity, actions: TimelineAction[]) => AuditEntryInput[] = opportunityFieldAudits
): Promise<{ saved: SavedOpportunity; actions: TimelineAction[] }> {
  const before = await tx.opportunity.findFirstOrThrow({
    where: opportunityWhere(ctx, opportunityId),
    select: opportunityTimelineSnapshotSelect,
  })
  const saved = await tx.opportunity.update({
    where: opportunityWhere(ctx, opportunityId),
    data,
    select: opportunityDetailSelect,
  })
  const actions = opportunityChangeActions(before, saved)
  const at = new Date()
  await recordTimelineActions(tx, { companyId: ctx.companyId, authorId: ctx.userId, subject: { opportunityId }, actions, at })
  await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: auditEntries(saved, actions), at })
  return { saved, actions }
}
