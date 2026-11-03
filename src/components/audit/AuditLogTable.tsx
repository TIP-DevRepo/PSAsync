"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from "@/components/table/ColumnFilters"
import { confirmDialog } from "@/lib/confirm-dialog"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  AUDIT_RECORD_TYPE_LABELS,
  auditActionLabel,
  auditFieldLabel,
  auditRecordHref,
  auditValueText,
  isAuditRecordType,
  type AuditRecordTypeKey,
} from "@/lib/audit-values"

// The audit log table, shared by Settings > Audit Log (every record type,
// with the Type filter and the Record column) and an opportunity's Audit
// log tab (that record only). Filtered and paged on the server: Type, the
// date range, and the column filters (Who, Record, Action, Field) live in
// the URL (type, from, to, f_<column>) and are sent to listUrl; Load more
// asks for the next page. Undo and Restore show where the server says they
// are allowed, ask first, and show a refusal's reason as it is.

export interface AuditEntry {
  id: string
  recordType: string
  recordId: string
  recordLabel: string
  action: string
  field: string | null
  before: unknown
  after: unknown
  actorName: string
  undoneAt: string | null
  undoneBy: { id: string; name: string } | null
  undoOfId: string | null
  createdAt: string
  record: { exists: boolean; deleted: boolean }
  canUndo: boolean
  canRestore: boolean
}

interface AuditPage {
  entries: AuditEntry[]
  nextCursor: string | null
  recordTypes?: string[]
}

type ColumnKey = "when" | "who" | "type" | "record" | "action" | "field" | "before" | "after"

// Fixed widths: below their total the table scrolls sideways. Never
// squeezed; long values wrap or collapse behind Show more.
const COLUMNS: { key: ColumnKey; label: string; width: number; filterable: boolean }[] = [
  { key: "when", label: "When", width: 180, filterable: false },
  { key: "who", label: "Who", width: 170, filterable: true },
  { key: "type", label: "Type", width: 140, filterable: false },
  { key: "record", label: "Record", width: 260, filterable: true },
  { key: "action", label: "Action", width: 190, filterable: true },
  { key: "field", label: "Field", width: 160, filterable: true },
  { key: "before", label: "Before", width: 280, filterable: false },
  { key: "after", label: "After", width: 280, filterable: false },
]
const FILTER_KEYS = ["who", "record", "action", "field"] as const
// The API parameter each column filter is sent as
const FILTER_PARAMS: Record<(typeof FILTER_KEYS)[number], string> = { who: "actor", record: "record", action: "action", field: "field" }
const TOGGLE_WIDTH = 44
const ACTIONS_WIDTH = 72
// Characters a value shows before Show more
const VALUE_PREVIEW_MAX = 140

const FIELD_CLASS =
  "rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// A local day (YYYY-MM-DD) as the instant it starts, for the API
function localDayStart(day: string, addDays = 0): string | null {
  if (!DATE_ONLY.test(day)) return null
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, m - 1, d + addDays)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// The API query for the filters: the record type, the column filters (as
// their API parameters), and the local days as the instants they start and
// end
function auditQuery(type: string, filters: Record<string, string>, from: string, to: string): string {
  const query = new URLSearchParams()
  if (type) query.set("recordType", type)
  for (const key of FILTER_KEYS) {
    const value = filters[key]?.trim()
    if (value) query.set(FILTER_PARAMS[key], value)
  }
  const fromIso = from ? localDayStart(from) : null
  const toIso = to ? localDayStart(to, 1) : null
  if (fromIso) query.set("from", fromIso)
  if (toIso) query.set("to", toIso)
  return query.toString()
}

// One page of the list, or the reason it couldn't load
async function fetchAuditPage(listUrl: string, queryKey: string, cursor: string | null): Promise<AuditPage | string> {
  const params = new URLSearchParams(queryKey)
  if (cursor) params.set("cursor", cursor)
  const res = await fetch(`${listUrl}?${params.toString()}`).catch(() => null)
  if (!res) return "Couldn't load the audit log. Check your connection and try again."
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return typeof data.error === "string" ? data.error : "Couldn't load the audit log."
  return data as AuditPage
}

const formatWhen = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function ValueCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > VALUE_PREVIEW_MAX || text.split("\n").length > 3
  return (
    <div className="space-y-1">
      <p className={cn("whitespace-pre-wrap break-words", long && !expanded && "line-clamp-3")}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

function EntryActions({ entry, busy, onUndo, onRestore }: { entry: AuditEntry; busy: boolean; onUndo: () => void; onRestore: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The chosen item runs once the menu has closed and focus is back on the
  // trigger, so the confirmation returns focus there
  const pendingAction = useRef<(() => void) | null>(null)
  if (!entry.canUndo && !entry.canRestore) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" aria-label={`Actions for this ${auditActionLabel(entry.action).toLowerCase()} entry`} disabled={busy} className="size-10 sm:size-8">
          <Menu aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onCloseAutoFocus={(e) => {
          const action = pendingAction.current
          if (!action) return
          pendingAction.current = null
          e.preventDefault()
          triggerRef.current?.focus()
          action()
        }}
      >
        {entry.canUndo && (
          <DropdownMenuItem onSelect={() => (pendingAction.current = onUndo)} className="min-h-11 py-2 sm:min-h-9">
            Undo this change
          </DropdownMenuItem>
        )}
        {entry.canRestore && (
          <DropdownMenuItem onSelect={() => (pendingAction.current = onRestore)} className="min-h-11 py-2 sm:min-h-9">
            Restore {AUDIT_RECORD_TYPE_LABELS[entry.recordType as AuditRecordTypeKey]?.toLowerCase() ?? "record"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AuditLogTable({
  listUrl,
  showTypeFilter = false,
  showRecordColumn = false,
  onChanged,
  filterRowId,
}: {
  // GET /api/audit-log, or one record's audit route
  listUrl: string
  showTypeFilter?: boolean
  showRecordColumn?: boolean
  // After an undo or restore changed the record
  onChanged?: () => void
  filterRowId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const columnFilters = useColumnFilters(FILTER_KEYS)
  const columns = COLUMNS.filter((c) => (c.key === "type" ? showTypeFilter : c.key === "record" ? showRecordColumn : true))
  const tableMinWidth = TOGGLE_WIDTH + ACTIONS_WIDTH + columns.reduce((sum, c) => sum + c.width, 0)

  // Type and the date range go into the URL at once; the column filters
  // follow the boxes once typing pauses (useColumnFilters)
  const typeParam = searchParams.get("type") ?? ""
  const type = isAuditRecordType(typeParam) ? typeParam : ""
  const from = DATE_ONLY.test(searchParams.get("from") ?? "") ? (searchParams.get("from") as string) : ""
  const to = DATE_ONLY.test(searchParams.get("to") ?? "") ? (searchParams.get("to") as string) : ""
  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(name, value)
    else params.delete(name)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // What the server is asked for, as one comparable string
  const queryKey = auditQuery(showTypeFilter ? type : "", columnFilters.applied, from, to)

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [recordTypes, setRecordTypes] = useState<string[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Bumped to load the first page again after an undo or restore
  const [reloadCount, setReloadCount] = useState(0)
  // The request the shown entries answer; loading until it matches
  const requestKey = `${listUrl}?${queryKey}#${reloadCount}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey
  // Only the newest request's answer is shown
  const latestKey = useRef(requestKey)

  // The first page, whenever the filters change
  useEffect(() => {
    latestKey.current = requestKey
    fetchAuditPage(listUrl, queryKey, null).then((page) => {
      if (latestKey.current !== requestKey) return
      setLoadedKey(requestKey)
      if (typeof page === "string") {
        setError(page)
        setEntries([])
        setNextCursor(null)
        return
      }
      setError(null)
      setEntries(page.entries)
      setNextCursor(page.nextCursor)
      if (page.recordTypes) setRecordTypes(page.recordTypes)
    })
  }, [listUrl, queryKey, requestKey])

  async function loadMore() {
    if (!nextCursor) return
    const key = requestKey
    setLoadingMore(true)
    const page = await fetchAuditPage(listUrl, queryKey, nextCursor)
    setLoadingMore(false)
    if (latestKey.current !== key) return
    if (typeof page === "string") {
      toast.error("Couldn't load more entries", page)
      return
    }
    setEntries((prev) => [...prev, ...page.entries])
    setNextCursor(page.nextCursor)
  }

  async function post(url: string, entryId: string, failTitle: string, successTitle: string) {
    setBusyId(entryId)
    const res = await fetch(url, { method: "POST" }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusyId(null)
    if (!res || !res.ok) {
      // A 409 says why in plain words; show it as it is
      toast.error(failTitle, typeof data.error === "string" ? data.error : "Please try again.")
      return
    }
    toast.success(successTitle)
    onChanged?.()
    setReloadCount((n) => n + 1)
  }

  async function handleUndo(entry: AuditEntry) {
    const field = auditFieldLabel(entry.field)
    const ok = await confirmDialog({
      title: "Undo this change?",
      description: `${field} on ${entry.recordLabel} goes back to "${auditValueText(entry.field, entry.before)}".`,
      confirmLabel: "Undo",
    })
    if (ok) post(`/api/audit-log/${entry.id}/undo`, entry.id, "Couldn't undo this change", "Change undone")
  }

  async function handleRestore(entry: AuditEntry) {
    const ok = await confirmDialog({
      title: `Restore ${entry.recordLabel}?`,
      description: "It shows in lists again, with its attachments and timeline.",
      confirmLabel: "Restore",
    })
    if (ok) post(`/api/opportunities/${entry.recordId}/restore`, entry.id, "Couldn't restore this opportunity", "Opportunity restored")
  }

  const cell = "py-3 pr-3 align-top"
  const filtersActive = columnFilters.active || !!type || !!from || !!to

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {showTypeFilter && (
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
            Type
            <select value={type} onChange={(e) => setParam("type", e.target.value)} className={FIELD_CLASS}>
              <option value="">All</option>
              {/* The types the company has entries for, plus the chosen one */}
              {[...new Set([...recordTypes, ...(type ? [type] : [])])].filter(isAuditRecordType).map((t) => (
                <option key={t} value={t}>
                  {AUDIT_RECORD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setParam("from", e.target.value)} className={FIELD_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setParam("to", e.target.value)} className={FIELD_CLASS} />
        </label>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              columnFilters.clear()
              const params = new URLSearchParams(searchParams.toString())
              for (const name of ["type", "from", "to"]) params.delete(name)
              const next = params.toString()
              router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
            }}
            className="pb-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: tableMinWidth }}>
          <colgroup>
            <col style={{ width: TOGGLE_WIDTH }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: ACTIONS_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th scope="col" className="py-1 pl-2">
                <ColumnFilterToggle
                  open={columnFilters.open}
                  active={columnFilters.active}
                  onToggle={() => columnFilters.setOpen(!columnFilters.open)}
                  rowId={filterRowId}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="py-2 pr-3 font-medium">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="py-2 pr-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
            {columnFilters.open && (
              <ColumnFilterRow
                id={filterRowId}
                columns={columns}
                filters={columnFilters.filters}
                onChange={columnFilters.setFilter}
                leadingCells={1}
              />
            )}
          </thead>
          <tbody>
            {entries.map((entry) => {
              const href = auditRecordHref(entry.recordType, entry.recordId)
              return (
                <tr key={entry.id} className="border-b border-border">
                  <td aria-hidden="true" />
                  <td className={cn(cell, "text-muted-foreground tabular-nums")}>{formatWhen(entry.createdAt)}</td>
                  <td className={cn(cell, "break-words text-foreground")}>{entry.actorName}</td>
                  {showTypeFilter && (
                    <td className={cn(cell, "text-muted-foreground")}>
                      {AUDIT_RECORD_TYPE_LABELS[entry.recordType as AuditRecordTypeKey] ?? entry.recordType}
                    </td>
                  )}
                  {showRecordColumn && (
                    <td className={cell}>
                      <div className="flex flex-wrap items-center gap-2">
                        {href && entry.record.exists ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-words text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {entry.recordLabel}
                          </a>
                        ) : (
                          <span className="break-words text-foreground">{entry.recordLabel}</span>
                        )}
                        {entry.record.deleted && (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Deleted</span>
                        )}
                      </div>
                    </td>
                  )}
                  <td className={cell}>
                    <p className="text-foreground">{auditActionLabel(entry.action)}</p>
                    {entry.undoneAt && (
                      <p className="text-xs text-muted-foreground">
                        Undone{entry.undoneBy ? ` by ${entry.undoneBy.name}` : ""} on {formatWhen(entry.undoneAt)}
                      </p>
                    )}
                  </td>
                  <td className={cn(cell, "text-muted-foreground")}>{auditFieldLabel(entry.field)}</td>
                  <td className={cn(cell, "text-muted-foreground")}>
                    <ValueCell text={auditValueText(entry.field, entry.before)} />
                  </td>
                  <td className={cn(cell, "text-foreground")}>
                    <ValueCell text={auditValueText(entry.field, entry.after)} />
                  </td>
                  <td className={cn(cell, "text-right")}>
                    <EntryActions entry={entry} busy={busyId === entry.id} onUndo={() => handleUndo(entry)} onRestore={() => handleRestore(entry)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && !error && entries.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">{filtersActive ? "No entries match these filters." : "Nothing has been recorded yet."}</p>
        )}
        {error && (
          <p role="alert" className="px-4 py-6 text-sm text-danger">
            {error}
          </p>
        )}
        {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading...</p>}
      </div>

      {nextCursor && !loading && (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  )
}
