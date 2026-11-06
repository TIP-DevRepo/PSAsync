import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { auditEntrySelect, entryUndoBlockReason, loadUndoLookups, type AuditEntryInput, type AuditEntryRow } from "@/lib/audit-log"
import { linkedUndoFields, recordDeletedMessage, undoBodyValue, undoRefusalMessage, UNDO_MESSAGES } from "@/lib/audit-values"
import { loadAuditRecordStates } from "@/lib/audit-records"
import { isPrismaError } from "@/lib/opportunity-rules"
import type { TimelineAction } from "@/lib/timeline-actions"
import type { Prisma } from "@/generated/prisma"

// Undoing one field_changed entry from the audit log, shared by every
// record type whose changes can be undone (opportunities and tickets). The
// entry's before value goes back through the same update rules as the
// record's PATCH (the adapter's plan), so every rule an edit follows holds
// for an undo too. Fields one change set together (LINKED_UNDO_FIELDS) are
// undone together when those entries can be undone too. One transaction
// claims each original (undoneAt, so two undos never both apply), checks
// nothing changed since, applies the change with its timeline actions, and
// writes an undone audit entry for each field (undoOfId).

export interface UndoAdapter<Existing, Saved> {
  // The record as the PATCH planner needs it, with deleted ones included
  // and the user's view check applied; null when they can't open it
  loadExisting: (ctx: AccessContext, recordId: string) => Promise<(Existing & { deletedAt: Date | null }) | null>
  plan: (ctx: AccessContext, existing: Existing, body: Record<string, unknown>) => Promise<{ data: object; response?: undefined } | { response: NextResponse; data?: undefined }>
  apply: (
    tx: Prisma.TransactionClient,
    ctx: AccessContext,
    recordId: string,
    data: object,
    auditEntries: (saved: Saved, actions: TimelineAction[]) => AuditEntryInput[]
  ) => Promise<{ saved: Saved }>
  // The field_changed entries a change records (the record's own builder)
  fieldAudits: (saved: Saved, actions: TimelineAction[]) => AuditEntryInput[]
  undoneAudit: (saved: Saved, undoOfId: string, field: string, before: unknown, after: unknown) => AuditEntryInput
  noAccessMessage: string
}

export type UndoResult<Saved> =
  | { saved: Saved; status?: undefined }
  | { status: 409; error: string; code: string; saved?: undefined }

const refused = <Saved>(error: string, code = "UNDO_REFUSED"): UndoResult<Saved> => ({ status: 409, error, code })

// Thrown inside the transaction when the entry stopped being undoable
class UndoRefusal extends Error {
  constructor(readonly reason: string) {
    super("Undo refused")
  }
}

export async function undoRecordChange<Existing extends { id: string }, Saved>(
  ctx: AccessContext,
  entry: AuditEntryRow,
  adapter: UndoAdapter<Existing, Saved>
): Promise<UndoResult<Saved>> {
  const states = (type: AuditEntryRow["recordType"], ids: string[]) => loadAuditRecordStates(ctx, type, ids)
  const lookups = await loadUndoLookups(prisma, ctx.companyId, [entry], states)
  const reason = entryUndoBlockReason(lookups, entry)
  if (reason) return refused(reason)
  const field = entry.field as string
  const deletedMessage = recordDeletedMessage(entry.recordType)

  const existing = await adapter.loadExisting(ctx, entry.recordId)
  if (!existing) return refused(adapter.noAccessMessage)
  if (existing.deletedAt) return refused(deletedMessage)

  // The fields recorded in the same change that the rules tie to this one
  const linked = linkedUndoFields(field, entry.recordType)
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
  const plan = await adapter.plan(ctx, existing, body)
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
      const result = await adapter.apply(tx, ctx, existing.id, plan.data, (record, actions) => {
        const entries: AuditEntryInput[] = []
        const undoneFields = new Set<string>()
        for (const change of adapter.fieldAudits(record, actions)) {
          const target = change.field ? byField.get(change.field) : undefined
          if (!target || !change.field) {
            // A field the rules changed along with it (a client's main location)
            entries.push(change)
            continue
          }
          undoneFields.add(change.field)
          entries.push(adapter.undoneAudit(record, target.id, change.field, change.before, change.after))
        }
        // A field already back at its old value still records its undo
        for (const t of targets) {
          if (!undoneFields.has(t.field as string)) entries.push(adapter.undoneAudit(record, t.id, t.field as string, t.after, t.before))
        }
        return entries
      })
      return result.saved
    })
    return { saved }
  } catch (err) {
    if (err instanceof UndoRefusal) return refused(err.reason)
    // Deleted since the check (the write matched no row)
    if (isPrismaError(err, "P2025")) return refused(deletedMessage)
    throw err
  }
}
