import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { viewableOpportunityIncludingDeletedWhere } from "@/lib/scoped-loaders"
import { auditEntrySelect, entryUndoBlockReason, loadUndoLookups, type AuditEntryInput, type AuditEntryRow } from "@/lib/audit-log"
import { linkedUndoFields, undoBodyValue, undoRefusalMessage, UNDO_MESSAGES } from "@/lib/audit-values"
import { loadAuditRecordStates } from "@/lib/audit-records"
import { applyOpportunityUpdate, opportunityUpdateExistingSelect, planOpportunityUpdate } from "@/lib/opportunity-update"
import { opportunityFieldAudits, opportunityUndoneAudit } from "@/lib/opportunity-audit"
import { isPrismaError } from "@/lib/opportunity-rules"
import type { opportunityDetailSelect } from "@/lib/opportunity-selects"
import type { Prisma } from "@/generated/prisma"

// Undoing one field_changed entry of an opportunity from the audit log.
// The entry's before value goes back through the same update rules as the
// opportunity PATCH (planOpportunityUpdate), so the owner must be in the
// team, the contact and location must belong to the client, stages set
// closedAt as usual, and the user must be able to open the opportunity.
// Fields one change set together (LINKED_UNDO_FIELDS: a client with its
// contact and location, a team with its owner) are undone together when
// those entries can be undone too. One transaction applies the change,
// records its timeline actions, writes an undone audit entry for each field
// (undoOfId), and marks each original undone.

export const UNDO_NO_ACCESS_MESSAGE = "This opportunity can't be found, or you don't have access to it"

export type UndoResult =
  | { saved: Prisma.OpportunityGetPayload<{ select: typeof opportunityDetailSelect }>; status?: undefined }
  | { status: 409; error: string; code: string; saved?: undefined }

const refused = (error: string, code = "UNDO_REFUSED"): UndoResult => ({ status: 409, error, code })

// Thrown inside the transaction when the entry stopped being undoable
class UndoRefusal extends Error {
  constructor(readonly reason: string) {
    super("Undo refused")
  }
}

export async function undoOpportunityChange(ctx: AccessContext, entry: AuditEntryRow): Promise<UndoResult> {
  const states = (type: AuditEntryRow["recordType"], ids: string[]) => loadAuditRecordStates(ctx, type, ids)
  const lookups = await loadUndoLookups(prisma, ctx.companyId, [entry], states)
  const reason = entryUndoBlockReason(lookups, entry)
  if (reason) return refused(reason)
  const field = entry.field as string

  const existing = await prisma.opportunity.findFirst({
    where: viewableOpportunityIncludingDeletedWhere(ctx, entry.recordId),
    select: { ...opportunityUpdateExistingSelect, deletedAt: true },
  })
  if (!existing) return refused(UNDO_NO_ACCESS_MESSAGE)
  if (existing.deletedAt) return refused(UNDO_MESSAGES.recordDeleted)

  // The fields recorded in the same change that the rules tie to this one
  const linked = linkedUndoFields(field)
  const companions =
    linked.length === 0
      ? []
      : await prisma.auditLogEntry.findMany({
          where: {
            companyId: ctx.companyId,
            recordType: entry.recordType,
            recordId: entry.recordId,
            action: "field_changed",
            field: { in: linked },
            createdAt: entry.createdAt,
            undoneAt: null,
          },
          select: auditEntrySelect,
        })
  const companionLookups = await loadUndoLookups(prisma, ctx.companyId, companions, states)
  const targets = [entry, ...companions.filter((c) => entryUndoBlockReason(companionLookups, c) === null)]
  const fields = targets.map((t) => t.field as string)

  const body = Object.fromEntries(targets.map((t) => [t.field as string, undoBodyValue(t.field as string, t.before)]))
  const plan = await planOpportunityUpdate(ctx, existing, body)
  if (plan.response) {
    const refusal = (await plan.response.json().catch(() => ({}))) as { error?: unknown; code?: unknown }
    const error = typeof refusal.error === "string" ? refusal.error : UNDO_MESSAGES.notUndoable
    return refused(undoRefusalMessage(error, typeof refusal.code === "string" ? refusal.code : undefined))
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const now = new Date()
      // Claims every original, so two undos never both apply
      const { count } = await tx.auditLogEntry.updateMany({
        where: { id: { in: targets.map((t) => t.id) }, companyId: ctx.companyId, undoneAt: null },
        data: { undoneAt: now, undoneById: ctx.userId },
      })
      if (count !== targets.length) throw new UndoRefusal(UNDO_MESSAGES.alreadyUndone)
      const later = await tx.auditLogEntry.count({
        where: {
          companyId: ctx.companyId,
          recordType: entry.recordType,
          recordId: entry.recordId,
          field: { in: fields },
          action: { in: ["field_changed", "undone"] },
          createdAt: { gt: entry.createdAt },
        },
      })
      if (later > 0) throw new UndoRefusal(UNDO_MESSAGES.changedSince)

      const byField = new Map(targets.map((t) => [t.field as string, t]))
      const result = await applyOpportunityUpdate(tx, ctx, existing.id, plan.data, (record, actions) => {
        const entries: AuditEntryInput[] = []
        const undoneFields = new Set<string>()
        for (const change of opportunityFieldAudits(record, actions)) {
          const target = change.field ? byField.get(change.field) : undefined
          if (!target || !change.field) {
            // A field the rules changed along with it (a client's main location)
            entries.push(change)
            continue
          }
          undoneFields.add(change.field)
          entries.push(opportunityUndoneAudit(record, target.id, change.field, change.before, change.after))
        }
        // A field already back at its old value still records its undo
        for (const t of targets) {
          if (!undoneFields.has(t.field as string)) entries.push(opportunityUndoneAudit(record, t.id, t.field as string, t.after, t.before))
        }
        return entries
      })
      return result.saved
    })
    return { saved }
  } catch (err) {
    if (err instanceof UndoRefusal) return refused(err.reason)
    // Deleted since the check (the write matched no row)
    if (isPrismaError(err, "P2025")) return refused(UNDO_MESSAGES.recordDeleted)
    throw err
  }
}
