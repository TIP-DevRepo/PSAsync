import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { viewableOpportunityIncludingDeletedWhere } from "@/lib/scoped-loaders"
import type { AuditEntryRow } from "@/lib/audit-log"
import { applyOpportunityUpdate, opportunityUpdateExistingSelect, planOpportunityUpdate, type OpportunityUpdateExisting } from "@/lib/opportunity-update"
import { opportunityFieldAudits, opportunityUndoneAudit } from "@/lib/opportunity-audit"
import type { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { undoRecordChange, type UndoAdapter, type UndoResult as RecordUndoResult } from "@/lib/record-undo"
import type { Prisma } from "@/generated/prisma"

// Undoing one field_changed entry of an opportunity from the audit log,
// through the shared undo (undoRecordChange in src/lib/record-undo.ts).
// The entry's before value goes back through the same update rules as the
// opportunity PATCH (planOpportunityUpdate), so the owner must be in the
// team, the contact and location must belong to the client, stages set
// closedAt as usual, and the user must be able to open the opportunity.
// Fields one change set together (LINKED_UNDO_FIELDS: a client with its
// contact and location, a team with its owner) are undone together when
// those entries can be undone too.

export const UNDO_NO_ACCESS_MESSAGE = "This opportunity can't be found, or you don't have access to it"

type SavedOpportunity = Prisma.OpportunityGetPayload<{ select: typeof opportunityDetailSelect }>

export type UndoResult = RecordUndoResult<SavedOpportunity>

const opportunityUndo: UndoAdapter<OpportunityUpdateExisting, SavedOpportunity> = {
  loadExisting: (ctx, recordId) =>
    prisma.opportunity.findFirst({
      where: viewableOpportunityIncludingDeletedWhere(ctx, recordId),
      select: { ...opportunityUpdateExistingSelect, deletedAt: true },
    }),
  plan: planOpportunityUpdate,
  apply: (tx, ctx, recordId, data, auditEntries) => applyOpportunityUpdate(tx, ctx, recordId, data, auditEntries),
  fieldAudits: opportunityFieldAudits,
  undoneAudit: opportunityUndoneAudit,
  noAccessMessage: UNDO_NO_ACCESS_MESSAGE,
}

export function undoOpportunityChange(ctx: AccessContext, entry: AuditEntryRow): Promise<UndoResult> {
  return undoRecordChange(ctx, entry, opportunityUndo)
}
