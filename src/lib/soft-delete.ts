import type { Prisma } from "@/generated/prisma"
import { recordTimelineActions, type TimelineSubject } from "@/lib/timeline"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"

// Restoring a soft deleted record (opportunities and tickets keep their row
// when deleted, with deletedAt and deletedById set, so an admin can restore
// them from the audit log). Shared by the restore routes. Runs inside the
// caller's transaction: clear sets deletedAt and deletedById back to null
// only on a row that is still deleted, so two restores never both record;
// then the restored timeline action and audit entry are written and the
// record read back. Null when nothing was cleared (restored meanwhile).

export const NOT_DELETED_CODE = "NOT_DELETED"
export const RESTORE_REFUSED_CODE = "RESTORE_REFUSED"

export async function restoreDeletedRecord<T>(
  tx: Pick<Prisma.TransactionClient, "timelineEntry" | "auditLogEntry" | "user">,
  opts: {
    companyId: string
    actorId: string
    clear: () => Promise<{ count: number }>
    subject: TimelineSubject
    // The record's kind as the timeline sentence says it, for example "Ticket"
    label: string
    audit: AuditEntryInput
    read: () => Promise<T>
  }
): Promise<T | null> {
  const { count } = await opts.clear()
  if (count === 0) return null
  const at = new Date()
  await recordTimelineActions(tx, {
    companyId: opts.companyId,
    authorId: opts.actorId,
    subject: opts.subject,
    actions: [{ action: "restored", data: { label: opts.label } }],
    at,
  })
  await recordAudit(tx, { companyId: opts.companyId, actorId: opts.actorId, entries: [opts.audit], at })
  return opts.read()
}
