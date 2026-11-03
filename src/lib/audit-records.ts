import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"
import type { AuditRecordType, Prisma } from "@/generated/prisma"
import {
  auditRecordTypesInUse,
  INVALID_AUDIT_CURSOR_MESSAGE,
  loadUndoLookups,
  readAuditFilters,
  readAuditPage,
  toAuditEntryResponse,
  type AuditRecordState,
} from "@/lib/audit-log"
import { auditEntryWhere, opportunityRecordStatesWhere } from "@/lib/scoped-loaders"

// What the audit routes share: each record's state now (deleted or not) and
// one page of entries in the response every audit list returns. Uses the
// shared client; the writes go through recordAudit (src/lib/audit-log.ts).

// Each record's state for these ids. Opportunities are read with deleted
// ones included (the audit log is the one place that shows them); a record
// type with no state lookup yet counts as existing and not deleted.
export async function loadAuditRecordStates(
  ctx: Pick<AccessContext, "companyId">,
  recordType: AuditRecordType,
  ids: string[]
): Promise<Map<string, AuditRecordState>> {
  const states = new Map<string, AuditRecordState>()
  if (recordType !== "OPPORTUNITY" || ids.length === 0) return states
  const rows = await prisma.opportunity.findMany({ where: opportunityRecordStatesWhere(ctx, ids), select: { id: true, deletedAt: true } })
  const found = new Map(rows.map((r) => [r.id, r.deletedAt]))
  for (const id of ids) states.set(id, found.has(id) ? { exists: true, deleted: found.get(id) !== null } : { exists: false, deleted: true })
  return states
}

// One page of an audit list: the server filters from the query string,
// the cursor (an entry the same scope holds), and each entry with its
// record state and whether this user may undo or restore from it.
// withRecordTypes adds the record types the company has entries for (the
// Type filter), on the first page only.
export async function auditListResponse(
  ctx: AccessContext,
  params: URLSearchParams,
  scope: Prisma.AuditLogEntryWhereInput,
  opts: { withRecordTypes: boolean }
): Promise<NextResponse> {
  const filters = readAuditFilters(params)
  if (filters.error !== undefined) return apiError(400, filters.error)

  const where: Prisma.AuditLogEntryWhereInput = { AND: [{ companyId: ctx.companyId }, scope, ...filters.where] }
  const cursor = params.get("cursor") || null
  if (cursor) {
    const known = await prisma.auditLogEntry.findFirst({ where: { AND: [auditEntryWhere(ctx, cursor), scope] }, select: { id: true } })
    if (!known) return apiError(400, INVALID_AUDIT_CURSOR_MESSAGE)
  }

  const page = await readAuditPage(prisma, where, cursor)
  const lookups = await loadUndoLookups(prisma, ctx.companyId, page.entries, (type, ids) => loadAuditRecordStates(ctx, type, ids))
  const mayRestore = ctx.can("auditLog.restore")
  return NextResponse.json({
    entries: page.entries.map((row) => toAuditEntryResponse(row, lookups, mayRestore)),
    nextCursor: page.nextCursor,
    ...(opts.withRecordTypes && !cursor ? { recordTypes: await auditRecordTypesInUse(prisma, ctx.companyId) } : {}),
  })
}
