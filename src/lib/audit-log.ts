import { Prisma, type AuditRecordType } from "@/generated/prisma"
import { readDate } from "@/lib/opportunity-rules"
import { COLUMN_FILTER_MAX } from "@/lib/column-filters"
import {
  actionKeysMatching,
  fieldKeysMatching,
  isAuditRecordType,
  undoBlockReason,
  type AuditActionKey,
  type UndoCandidate,
} from "@/lib/audit-values"

// The shared audit log (AuditLogEntry): the admin record of every change,
// kept forever. Opportunities record theirs now; tickets, quotes, sales
// orders, and purchase orders add theirs in later branches with the same
// helper. No database client of its own: callers pass the transaction
// their change runs in, so a change and its entries are saved together or
// not at all.

export const AUDIT_PAGE_SIZE = 50
export const SYSTEM_ACTOR_NAME = "System"
export const UNKNOWN_ACTOR_NAME = "Unknown user"
// A record label is a snapshot for the table, never longer than this
const RECORD_LABEL_MAX = 300

export const INVALID_AUDIT_CURSOR_MESSAGE = "Invalid cursor"

// One entry to write. before and after hold names next to ids (see
// src/lib/audit-values.ts); null or left out is "nothing".
export interface AuditEntryInput {
  recordType: AuditRecordType
  recordId: string
  recordLabel: string
  action: AuditActionKey
  field?: string | null
  before?: unknown
  after?: unknown
  undoOfId?: string | null
}

type AuditDb = Pick<Prisma.TransactionClient, "auditLogEntry" | "user">

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue))

// Writes the entries inside the caller's transaction, all at the same time
// (one change), by actorId (null is the system). The actor's name is read
// in the same transaction and stored with each entry. Nothing when there
// is nothing to record.
export async function recordAudit(
  db: AuditDb,
  opts: { companyId: string; actorId: string | null; entries: AuditEntryInput[]; at?: Date }
): Promise<void> {
  if (opts.entries.length === 0) return
  const actor = opts.actorId
    ? await db.user.findFirst({ where: { id: opts.actorId, companyId: opts.companyId }, select: { name: true } })
    : null
  const actorName = opts.actorId ? (actor?.name ?? UNKNOWN_ACTOR_NAME) : SYSTEM_ACTOR_NAME
  const createdAt = opts.at ?? new Date()
  await db.auditLogEntry.createMany({
    data: opts.entries.map((e) => ({
      companyId: opts.companyId,
      recordType: e.recordType,
      recordId: e.recordId,
      recordLabel: e.recordLabel.slice(0, RECORD_LABEL_MAX),
      action: e.action,
      field: e.field ?? null,
      before: json(e.before),
      after: json(e.after),
      actorId: opts.actorId,
      actorName,
      undoOfId: e.undoOfId ?? null,
      createdAt,
    })),
  })
}

// ─── Reading ────────────────────────────────────────────────────────────────

export const auditEntrySelect = {
  id: true,
  recordType: true,
  recordId: true,
  recordLabel: true,
  action: true,
  field: true,
  before: true,
  after: true,
  actorId: true,
  actorName: true,
  undoneAt: true,
  undoneBy: { select: { id: true, name: true } },
  undoOfId: true,
  createdAt: true,
} satisfies Prisma.AuditLogEntrySelect

export type AuditEntryRow = Prisma.AuditLogEntryGetPayload<{ select: typeof auditEntrySelect }>

// Each record an entry is about, as the audit routes see it now. Records of
// a type with no state lookup yet count as existing and not deleted.
export interface AuditRecordState {
  exists: boolean
  deleted: boolean
}

// The undo context of entries: whether their record is deleted, and the
// latest field_changed or undone entry for each record and field.
// loadRecordStates reads the records (for opportunities, including deleted
// ones); latestChange the newest change time per record and field.
export interface UndoLookups {
  recordStates: Map<string, AuditRecordState>
  latestChange: Map<string, Date>
}

const changeKey = (recordId: string, field: string) => `${recordId}\u0000${field}`

export async function loadUndoLookups(
  db: Pick<Prisma.TransactionClient, "auditLogEntry">,
  companyId: string,
  entries: Pick<AuditEntryRow, "recordType" | "recordId" | "field" | "action">[],
  loadRecordStates: (recordType: AuditRecordType, ids: string[]) => Promise<Map<string, AuditRecordState>>
): Promise<UndoLookups> {
  const recordStates = new Map<string, AuditRecordState>()
  for (const type of new Set(entries.map((e) => e.recordType))) {
    const ids = [...new Set(entries.filter((e) => e.recordType === type).map((e) => e.recordId))]
    for (const [id, state] of await loadRecordStates(type, ids)) recordStates.set(`${type}:${id}`, state)
  }

  const latestChange = new Map<string, Date>()
  const changes = entries.filter((e) => e.action === "field_changed" && e.field)
  if (changes.length > 0) {
    const groups = await db.auditLogEntry.groupBy({
      by: ["recordId", "field"],
      where: {
        companyId,
        recordId: { in: [...new Set(changes.map((e) => e.recordId))] },
        field: { in: [...new Set(changes.map((e) => e.field as string))] },
        action: { in: ["field_changed", "undone"] },
      },
      _max: { createdAt: true },
    })
    for (const g of groups) {
      if (g.field && g._max.createdAt) latestChange.set(changeKey(g.recordId, g.field), g._max.createdAt)
    }
  }
  return { recordStates, latestChange }
}

export function recordStateOf(lookups: UndoLookups, entry: Pick<AuditEntryRow, "recordType" | "recordId">): AuditRecordState {
  return lookups.recordStates.get(`${entry.recordType}:${entry.recordId}`) ?? { exists: true, deleted: false }
}

// Why this entry can't be undone now (undoBlockReason with what the
// database says), or null when it can
export function entryUndoBlockReason(
  lookups: UndoLookups,
  entry: UndoCandidate & Pick<AuditEntryRow, "recordId" | "createdAt">
): string | null {
  const state = recordStateOf(lookups, { recordType: entry.recordType as AuditRecordType, recordId: entry.recordId })
  const latest = entry.field ? lookups.latestChange.get(changeKey(entry.recordId, entry.field)) : undefined
  return undoBlockReason(entry, {
    recordDeleted: !state.exists || state.deleted,
    changedSince: !!latest && latest.getTime() > entry.createdAt.getTime(),
  })
}

// What every audit route returns for an entry: the stored row, whether its
// record is deleted, and whether this user may undo or restore from it now
export function toAuditEntryResponse(row: AuditEntryRow, lookups: UndoLookups, mayRestore: boolean) {
  const state = recordStateOf(lookups, row)
  return {
    ...row,
    record: { exists: state.exists, deleted: !state.exists || state.deleted },
    canUndo: mayRestore && entryUndoBlockReason(lookups, row) === null,
    canRestore: mayRestore && row.action === "deleted" && state.exists && state.deleted,
  }
}

export type AuditEntryResponse = ReturnType<typeof toAuditEntryResponse>

// One page of entries, newest first (ties by id, so a page boundary never
// skips or repeats one). cursor is the last entry of the previous page,
// already checked to match the same where. nextCursor is null on the last
// page.
export async function readAuditPage(db: Pick<Prisma.TransactionClient, "auditLogEntry">, where: Prisma.AuditLogEntryWhereInput, cursor: string | null) {
  const rows = await db.auditLogEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: auditEntrySelect,
  })
  const more = rows.length > AUDIT_PAGE_SIZE
  const entries = more ? rows.slice(0, AUDIT_PAGE_SIZE) : rows
  return { entries, nextCursor: more ? entries[entries.length - 1].id : null }
}

// ─── Filters ────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const AUDIT_DATE_RANGE_MESSAGE = "The date range must use valid dates"

// The server side filters of an audit list, from its query string:
//   recordType  one AuditRecordType
//   action      text matched against the action's plain words (or key)
//   actor       text in the actor's stored name
//   record      text in the record label
//   field       text matched against the field's label (or key)
//   from, to    YYYY-MM-DD (to includes that whole day, UTC) or ISO date
//               and time (from inclusive, to exclusive)
// Text is capped at COLUMN_FILTER_MAX. A refusal is a plain message for a 400.
export function readAuditFilters(params: { get(name: string): string | null }): { where: Prisma.AuditLogEntryWhereInput[]; error?: undefined } | { error: string; where?: undefined } {
  const where: Prisma.AuditLogEntryWhereInput[] = []
  const text = (name: string) => (params.get(name) ?? "").trim().slice(0, COLUMN_FILTER_MAX)

  const recordType = text("recordType")
  if (recordType) {
    if (!isAuditRecordType(recordType)) return { error: "Invalid record type" }
    where.push({ recordType })
  }
  const action = text("action")
  if (action) where.push({ action: { in: actionKeysMatching(action) } })
  const actor = text("actor")
  if (actor) where.push({ actorName: { contains: actor, mode: "insensitive" } })
  const record = text("record")
  if (record) where.push({ recordLabel: { contains: record, mode: "insensitive" } })
  const field = text("field")
  if (field) where.push({ field: { in: fieldKeysMatching(field) } })

  const fromText = text("from")
  const from = readDate(fromText, AUDIT_DATE_RANGE_MESSAGE)
  if (from.error !== undefined) return { error: from.error }
  if (from.value) where.push({ createdAt: { gte: from.value } })
  const toText = text("to")
  const to = readDate(toText, AUDIT_DATE_RANGE_MESSAGE)
  if (to.error !== undefined) return { error: to.error }
  // A date alone includes that whole day
  if (to.value) where.push({ createdAt: { lt: DATE_ONLY.test(toText) ? new Date(to.value.getTime() + DAY) : to.value } })

  return { where }
}

// The record types the company has entries for, for the Type filter
export async function auditRecordTypesInUse(db: Pick<Prisma.TransactionClient, "auditLogEntry">, companyId: string): Promise<AuditRecordType[]> {
  const groups = await db.auditLogEntry.groupBy({ by: ["recordType"], where: { companyId } })
  return groups.map((g) => g.recordType)
}
