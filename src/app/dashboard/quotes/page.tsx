"use client"

import { useState, useEffect, useRef, useLayoutEffect } from "react"
import { useFixedMenuPosition, useCloseOnOutsideClick, useCloseOnScroll } from "@/lib/useFixedMenu"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Pencil, Mail, Search, Flag, MessageSquare, MoreVertical, UserPlus, Copy, Workflow, FileText, ExternalLink, Link2, History, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import { Modal } from "@/components/Modal"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { TabsBar } from "@/components/ui/tabs-bar"

// ─── Types ────────────────────────────────────────────────────────────────
interface Quote {
  id: string
  quoteNumber: string
  version: number
  status: string
  title: string | null
  accessToken: string
  flagged: boolean
  templateId: string | null
  clientName: string
  contactName: string | null
  owner: { id: string; name: string } | null
  total: number
  hasUnreadComment: boolean
  createdAt: string
  sentAt: string | null
  expiresAt: string | null
  acceptedAt: string | null
  draftVersionId: string | null
  draftVersionNumber: number | null
}

interface QuoteComment {
  id: string
  authorType: "INTERNAL" | "CLIENT"
  authorName: string
  message: string
  createdAt: string
}

interface Scorecard {
  totalQuotes: number
  counts: Record<string, number>
  totalValue: number
  acceptedValue: number
}

interface Template {
  id: string
  name: string
  description: string | null
  expiryDays: number
  active: boolean
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-warning-bg text-warning",
  SENT: "bg-info-bg text-info",
  VIEWED: "bg-primary/10 text-primary",
  ACCEPTED: "bg-success-bg text-success",
  DECLINED: "bg-danger-bg text-danger",
  EXPIRED: "bg-warning-bg text-warning",
}

const STAGE_BAR_COLORS: Record<string, string> = {
  DRAFT: "bg-muted-foreground/30",
  PENDING_APPROVAL: "bg-warning",
  SENT: "bg-info",
  VIEWED: "bg-primary",
  ACCEPTED: "bg-success",
  DECLINED: "bg-danger",
  EXPIRED: "bg-warning/70",
}

const STAGE_PROGRESS: Record<string, number> = {
  DRAFT: 10,
  PENDING_APPROVAL: 25,
  SENT: 40,
  VIEWED: 65,
  ACCEPTED: 100,
  DECLINED: 100,
  EXPIRED: 100,
}

function statusLabel(status: string) {
  if (status === "ACCEPTED") return "Approved"
  if (status === "DECLINED") return "Lost"
  return status.replace("_", " ")
}

const AVATAR_COLORS = [
  "bg-red-200 text-red-800",
  "bg-blue-200 text-blue-800",
  "bg-green-200 text-green-800",
  "bg-purple-200 text-purple-800",
  "bg-amber-200 text-amber-800",
  "bg-pink-200 text-pink-800",
  "bg-teal-200 text-teal-800",
]

function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase()
}

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString() : "—"
}

// ─── Data Table sort/density helpers ──────────────────────────────────────
type SortColumn = "number" | "customer" | "name" | "stage" | "total" | "sentAt" | "expiresAt" | "acceptedAt"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function compareQuotes(a: Quote, b: Quote, column: SortColumn): number {
  switch (column) {
    case "number":
      return a.quoteNumber.localeCompare(b.quoteNumber)
    case "customer":
      return (a.contactName ?? a.clientName).localeCompare(b.contactName ?? b.clientName)
    case "name":
      return (a.title ?? "").localeCompare(b.title ?? "")
    case "stage":
      return (STAGE_PROGRESS[a.status] ?? 0) - (STAGE_PROGRESS[b.status] ?? 0)
    case "total":
      return a.total - b.total
    case "sentAt":
      return (a.sentAt ? new Date(a.sentAt).getTime() : 0) - (b.sentAt ? new Date(b.sentAt).getTime() : 0)
    case "expiresAt":
      return (a.expiresAt ? new Date(a.expiresAt).getTime() : 0) - (b.expiresAt ? new Date(b.expiresAt).getTime() : 0)
    case "acceptedAt":
      return (a.acceptedAt ? new Date(a.acceptedAt).getTime() : 0) - (b.acceptedAt ? new Date(b.acceptedAt).getTime() : 0)
    default:
      return 0
  }
}

function SortableHeader({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  align,
}: {
  label: string
  column: SortColumn
  sortColumn: SortColumn | null
  sortDirection: SortDirection
  onSort: (column: SortColumn) => void
  align?: "right"
}) {
  const active = sortColumn === column
  return (
    <th className={`py-2 pr-3 select-none ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(column)}
        className={`flex items-center gap-1 hover:text-foreground ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}
        {active && sortDirection === "asc" && <ArrowUp size={12} />}
        {active && sortDirection === "desc" && <ArrowDown size={12} />}
        {!active && <ArrowUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
}

// ─── Tabs System ────────────────────────────────────────────────────────
type TabKey = "scorecard" | "quotes" | "templates"

const TOP_TABS: { key: TabKey; label: string }[] = [
  { key: "scorecard", label: "Scorecard" },
  { key: "quotes", label: "Quotes" },
  { key: "templates", label: "Templates" },
]

// ─── Main Page ────────────────────────────────────────────────────────────
export default function QuotesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("quotes")
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  const [displayedTab, setDisplayedTab] = useState<TabKey>(activeTab)
  const [contentVisible, setContentVisible] = useState(true)

  useEffect(() => {
    if (activeTab === displayedTab) return
    setContentVisible(false)
    const timer = setTimeout(() => {
      setDisplayedTab(activeTab)
      setContentVisible(true)
    }, 80)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Quotes</h1>
        <Button onClick={() => setShowTemplatePicker(true)}>New Quote</Button>
      </div>

      <TabsBar tabs={TOP_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Quotes sections" />

      <div
        role="tabpanel"
        id={`tabpanel-${displayedTab}`}
        aria-labelledby={`tab-${displayedTab}`}
        className={`transition-opacity duration-150 ${contentVisible ? "opacity-100" : "opacity-0"}`}
      >
        {displayedTab === "scorecard" && <ScorecardTab />}
        {displayedTab === "quotes" && <QuotesTab />}
        {displayedTab === "templates" && <TemplatesTab />}
      </div>

      {showTemplatePicker && (
        <TemplatePickerModal onClose={() => setShowTemplatePicker(false)} />
      )}
    </div>
  )
}

// ─── Scorecard Tab ────────────────────────────────────────────────────────
function ScorecardTab() {
  const [data, setData] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/quote-scorecard")
      .then((res) => res.json())
      .then((json) => {
        setData(json)
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (!data) return <p className="text-sm text-danger">Could not load scorecard.</p>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-caption text-muted-foreground">Total Quotes</p>
          <p className="text-heading font-semibold text-foreground">{data.totalQuotes}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-caption text-muted-foreground">Total Value</p>
          <p className="text-heading font-semibold text-foreground">${data.totalValue.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-caption text-muted-foreground">Approved Value</p>
          <p className="text-heading font-semibold text-success">${data.acceptedValue.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-caption text-muted-foreground">Approved Quotes</p>
          <p className="text-heading font-semibold text-success">{data.counts.ACCEPTED ?? 0}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-card">
        <h3 className="font-semibold text-sm mb-3 text-foreground">By Status</h3>
        <div className="space-y-2">
          {Object.entries(data.counts).map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-sm">
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}>
                {statusLabel(status)}
              </span>
              <span className="font-medium text-foreground">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Quotes Tab ───────────────────────────────────────────────────────────
function QuotesTab() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [openChoiceFor, setOpenChoiceFor] = useState<Quote | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState("")
  const [revisionsFor, setRevisionsFor] = useState<Quote | null>(null)
  const [commentsFor, setCommentsFor] = useState<Quote | null>(null)
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")
  const selectAllRef = useRef<HTMLInputElement>(null)

  function loadQuotes() {
    fetch("/api/quotes")
      .then((res) => res.json())
      .then((json) => {
        setQuotes(json)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadQuotes()
  }, [])

  const filtered = quotes.filter((q) => {
    const matchesSearch =
      q.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
      q.clientName.toLowerCase().includes(search.toLowerCase()) ||
      (q.contactName ?? "").toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "ALL" || q.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compareQuotes(a, b, sortColumn)
          return sortDirection === "asc" ? cmp : -cmp
        })
      : filtered

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < filtered.length
    }
  }, [selected, filtered.length])

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  function handleSort(column: SortColumn) {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection("asc")
    } else if (sortDirection === "asc") {
      setSortDirection("desc")
    } else if (sortDirection === "desc") {
      setSortColumn(null)
      setSortDirection(null)
    } else {
      setSortDirection("asc")
    }
  }

  function handleOpenQuote(quote: Quote) {
    if (quote.draftVersionId) {
      setOpenChoiceFor(quote)
    } else {
      router.push(`/dashboard/quotes/${quote.id}`)
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((q) => q.id)))
    }
  }

  // Row interaction rules (per feedback):
  // - Plain click on the row does nothing — avoids accidental bulk-select
  //   while browsing.
  // - Shift+click on the row toggles that row's selection, same as the
  //   checkbox — a fast "select without aiming for a 16px target" path.
  // - Double-click anywhere on the row opens the quote. Single click only
  //   opens it from the quote-number link or the Edit icon specifically
  //   (both already stopPropagation so they don't also trigger select).
  function handleRowClick(e: React.MouseEvent, quoteId: string) {
    if (e.shiftKey) toggleSelected(quoteId)
  }

  async function handleToggleFlag(quoteId: string) {
    setQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, flagged: !q.flagged } : q)))
    await fetch(`/api/quotes/${quoteId}/flag`, { method: "POST" })
  }

  async function handleBulkSubmit() {
    if (!bulkAction || selected.size === 0) return
    const count = selected.size

    if (bulkAction === "delete") {
      const confirmed = await confirmDialog({
        title: `Delete ${count} quote${count === 1 ? "" : "s"}?`,
        description: "This can't be undone.",
        confirmLabel: "Delete",
        variant: "danger",
      })
      if (!confirmed) return
      await Promise.all(
        Array.from(selected).map((id) => fetch(`/api/quotes/${id}`, { method: "DELETE" }))
      )
      toast.success(`Deleted ${count} quote${count === 1 ? "" : "s"}`)
    } else if (bulkAction === "mark_lost") {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/quotes/${id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "DECLINED" }),
          })
        )
      )
      toast.success(`Marked ${count} quote${count === 1 ? "" : "s"} as Lost`)
    } else if (bulkAction === "mark_expired") {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/quotes/${id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "EXPIRED" }),
          })
        )
      )
      toast.success(`Marked ${count} quote${count === 1 ? "" : "s"} as Expired`)
    }

    setSelected(new Set())
    setBulkAction("")
    loadQuotes()
  }

  function handleExportCsv() {
    const headers = ["Number", "Customer", "Name", "Stage", "Total", "Last Sent", "Expiry", "Won Date"]
    const rows = sorted.map((q) => [
      q.version > 1 ? `${q.quoteNumber} v${q.version}` : q.quoteNumber,
      q.contactName ? `${q.contactName} (${q.clientName})` : q.clientName,
      q.title ?? "",
      statusLabel(q.status),
      q.total.toFixed(2),
      fmtDate(q.sentAt),
      fmtDate(q.expiresAt),
      fmtDate(q.acceptedAt),
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "quotes.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={bulkAction}
            onChange={(e) => {
              setBulkAction(e.target.value)
              e.target.blur()
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Bulk actions:</option>
            <option value="mark_lost">Mark as Lost</option>
            <option value="mark_expired">Mark as Expired</option>
            <option value="delete">Delete</option>
          </select>
          <Button variant="outline" size="sm" onClick={handleBulkSubmit} disabled={!bulkAction || selected.size === 0}>
            Submit
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={density}
            onChange={(e) => {
              setDensity(e.target.value as Density)
              e.target.blur()
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="compact">Compact rows</option>
            <option value="default">Default rows</option>
            <option value="comfortable">Comfortable rows</option>
          </select>
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            Export to CSV
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search by quote #, client, or contact..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            e.target.blur()
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="SENT">Sent</option>
          <option value="VIEWED">Viewed</option>
          <option value="ACCEPTED">Approved</option>
          <option value="DECLINED">Lost</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        Double-click a row to open it · Shift+click or use the checkbox to select for bulk actions
      </p>

      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th className="py-2 pr-2 w-8">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="accent-primary"
                />
              </th>
              <th className="py-2 pr-3 uppercase tracking-wide">Owner</th>
              <SortableHeader label="Number" column="number" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Customer" column="customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Stage" column="stage" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="Last Sent Date" column="sentAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Expiry Date" column="expiresAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Won Date" column="acceptedAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <th className="py-2 pr-3 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((quote) => {
              const isSelected = selected.has(quote.id)
              return (
                <tr
                  key={quote.id}
                  onClick={(e) => handleRowClick(e, quote.id)}
                  onDoubleClick={() => handleOpenQuote(quote)}
                  className={`border-b border-border cursor-pointer align-top select-none transition-colors ${
                    isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-surface-hover"
                  }`}
                >
                  <td className={`${ROW_PADDING[density]} pr-2`} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(quote.id)}
                      className="accent-primary"
                    />
                  </td>
                  <td className={`${ROW_PADDING[density]} pr-3`}>
                    {quote.owner && (
                      <div
                        title={quote.owner.name}
                        className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(quote.owner.name)}`}
                      >
                        {initials(quote.owner.name)}
                      </div>
                    )}
                  </td>
                  <td className={`${ROW_PADDING[density]} pr-3`} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenQuote(quote)}
                      className="font-medium text-foreground hover:underline hover:text-primary text-left"
                    >
                      {quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber}
                    </button>
                    {quote.draftVersionId && (
                      <div
                        title={`Version ${quote.draftVersionNumber} draft in progress`}
                        className="mt-1 inline-block rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning"
                      >
                        Draft v{quote.draftVersionNumber} in progress
                      </div>
                    )}
                  </td>
                  <td className={`${ROW_PADDING[density]} pr-3`}>
                    <p className="font-medium text-foreground">{quote.contactName ?? quote.clientName}</p>
                    {quote.contactName && <p className="text-caption text-muted-foreground">{quote.clientName}</p>}
                  </td>
                  <td className={`${ROW_PADDING[density]} pr-3 text-foreground`}>{quote.title ?? "—"}</td>
                  <td className={`${ROW_PADDING[density]} pr-3 w-40`}>
                    <p className="text-caption font-medium mb-1 text-foreground">{statusLabel(quote.status)}</p>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className={`h-1.5 rounded-full ${STAGE_BAR_COLORS[quote.status]}`}
                        style={{ width: `${STAGE_PROGRESS[quote.status] ?? 0}%` }}
                      />
                    </div>
                  </td>
                  <td className={`${ROW_PADDING[density]} pr-3 text-right tabular-nums font-medium text-foreground`}>${quote.total.toFixed(2)}</td>
                  <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{fmtDate(quote.sentAt)}</td>
                  <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{fmtDate(quote.expiresAt)}</td>
                  <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{fmtDate(quote.acceptedAt)}</td>
                  <td className={`${ROW_PADDING[density]} pr-3`} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 relative">
                      <button
                        title="Edit"
                        onClick={() => router.push(`/dashboard/quotes/${quote.id}`)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        title="Send Quote"
                        onClick={() => router.push(`/dashboard/quotes/${quote.id}?send=1`)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Mail size={15} />
                      </button>
                      <button
                        title="View Portal"
                        onClick={() => window.open(`/portal/${quote.accessToken}`, "_blank")}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Search size={15} />
                      </button>
                      <button
                        title={quote.flagged ? "Unflag" : "Flag for follow-up"}
                        onClick={() => handleToggleFlag(quote.id)}
                        className={quote.flagged ? "text-warning" : "text-muted-foreground hover:text-foreground"}
                      >
                        <Flag size={15} fill={quote.flagged ? "currentColor" : "none"} />
                      </button>
                      <button
                        title="Comments"
                        onClick={() => setCommentsFor(quote)}
                        className="relative text-muted-foreground hover:text-foreground"
                      >
                        <MessageSquare size={15} />
                        {quote.hasUnreadComment && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-danger" />
                        )}
                      </button>
                      <QuoteActionsMenu
                        quote={quote}
                        onDeleted={() => setQuotes((prev) => prev.filter((q) => q.id !== quote.id))}
                        onUpdated={loadQuotes}
                        onShowRevisions={() => setRevisionsFor(quote)}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-muted-foreground">
                  No quotes found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openChoiceFor && (
        <OpenChoiceModal
          quote={openChoiceFor}
          onClose={() => setOpenChoiceFor(null)}
        />
      )}

      {revisionsFor && (
        <RevisionsModal quote={revisionsFor} onClose={() => setRevisionsFor(null)} />
      )}

      {commentsFor && (
        <QuickReplyModal
          quote={commentsFor}
          onClose={() => setCommentsFor(null)}
          onViewed={() =>
            setQuotes((prev) =>
              prev.map((q) => (q.id === commentsFor.id ? { ...q, hasUnreadComment: false } : q))
            )
          }
        />
      )}
    </div>
  )
}

// ─── Quick Reply Modal (comment thread from the list, no page nav) ──────
function QuickReplyModal({
  quote,
  onClose,
  onViewed,
}: {
  quote: Quote
  onClose: () => void
  onViewed: () => void
}) {
  const [comments, setComments] = useState<QuoteComment[]>([])
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState("")
  const [posting, setPosting] = useState(false)

  function loadComments() {
    fetch(`/api/quotes/${quote.id}/comments`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setComments(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadComments()
    fetch(`/api/quotes/${quote.id}/mark-comments-viewed`, { method: "POST" })
      .then(() => onViewed())
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id])

  async function handlePost() {
    if (!newComment.trim()) return
    setPosting(true)
    await fetch(`/api/quotes/${quote.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newComment.trim() }),
    })
    setNewComment("")
    setPosting(false)
    loadComments()
  }

  return (
    <Modal maxWidth="md" scrollable>
      <h2 className="text-lg font-bold text-foreground">{quote.quoteNumber} — Comments</h2>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        )}
        {comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-md p-3 text-sm max-w-[85%] ${
              c.authorType === "INTERNAL"
                ? "bg-muted ml-auto text-foreground"
                : "bg-info-bg text-foreground"
            }`}
          >
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {c.authorName} · {new Date(c.createdAt).toLocaleString()}
            </p>
            <p className="whitespace-pre-wrap">{c.message}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Reply to the client..."
          rows={2}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handlePost} disabled={posting || !newComment.trim()}>
          {posting ? "Sending..." : "Send"}
        </Button>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

// ─── Open Choice Modal (live version vs. draft in progress) ──────────────
function OpenChoiceModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const router = useRouter()

  return (
    <Modal maxWidth="sm">
      <h2 className="text-lg font-bold text-foreground">
          {quote.quoteNumber} has a draft in progress
        </h2>
        <p className="text-sm text-muted-foreground">
          Version {quote.version} is the current live quote. Version {quote.draftVersionNumber} is
          a draft revision that hasn&apos;t been sent yet. Which would you like to open?
        </p>
        <div className="space-y-2">
          <button
            onClick={() => router.push(`/dashboard/quotes/${quote.id}`)}
            className="w-full rounded-md border border-border p-3 text-left text-sm hover:bg-surface-hover"
          >
            <p className="font-medium text-foreground">View Current Live Quote</p>
            <p className="text-xs text-muted-foreground">v{quote.version} · {statusLabel(quote.status)}</p>
          </button>
          <button
            onClick={() => router.push(`/dashboard/quotes/${quote.draftVersionId}`)}
            className="w-full rounded-md border border-border p-3 text-left text-sm hover:bg-surface-hover"
          >
            <p className="font-medium text-foreground">Work on New Version Draft</p>
            <p className="text-xs text-muted-foreground">v{quote.draftVersionNumber} · Draft</p>
          </button>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
    </Modal>
  )
}

// ─── Quote Actions Menu (expanded kebab menu) ─────────────────────────────
function QuoteActionsMenu({
  quote,
  onDeleted,
  onUpdated,
  onShowRevisions,
}: {
  quote: Quote
  onDeleted: () => void
  onUpdated: () => void
  onShowRevisions: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [subPanel, setSubPanel] = useState<"assign" | "status" | null>(null)
  const [users, setUsers] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null)
  const { menuRef, style: menuStyle } = useFixedMenuPosition(open, anchor)

  useCloseOnOutsideClick(open, [menuRef, buttonRef], () => {
    setOpen(false)
    setSubPanel(null)
  })

  useCloseOnScroll(open, () => {
    setOpen(false)
    setSubPanel(null)
  })

  function toggleOpen() {
    if (open) {
      setOpen(false)
      setSubPanel(null)
    } else {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
      }
      setOpen(true)
    }
  }

  function openAssign() {
    setSubPanel("assign")
    if (users.length === 0) {
      fetch("/api/users")
        .then((res) => res.json())
        .then((data) => setUsers(data.filter((u: { active: boolean }) => u.active)))
    }
  }

  async function handleAssign(userId: string) {
    await fetch(`/api/quotes/${quote.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    setOpen(false)
    setSubPanel(null)
    onUpdated()
  }

  async function handleChangeStatus(status: string) {
    await fetch(`/api/quotes/${quote.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setOpen(false)
    setSubPanel(null)
    onUpdated()
  }

  async function handleCopyQuote() {
    setCopying(true)
    const res = await fetch(`/api/quotes/${quote.id}/copy`, { method: "POST" })
    const data = await res.json()
    setCopying(false)
    if (res.ok && data.id) {
      router.push(`/dashboard/quotes/${data.id}`)
    }
  }

  function handleCopyPublicLink() {
    const url = `${window.location.origin}/portal/${quote.accessToken}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleDelete() {
    const confirmed = await confirmDialog({
      title: "Delete this quote permanently?",
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/quotes/${quote.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Quote deleted")
      onDeleted()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error("Couldn't delete this quote", data.error)
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        title="More"
        onClick={toggleOpen}
        className="text-muted-foreground hover:text-foreground"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-50 w-56 rounded-md border border-border bg-popover shadow-popover text-sm overflow-hidden"
        >
          {subPanel === null && (
            <>
              <button
                onClick={openAssign}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                Assign <UserPlus size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={handleCopyQuote}
                disabled={copying}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                {copying ? "Copying..." : "Copy"} <Copy size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={() => setSubPanel("status")}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                Change Status <Workflow size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={() => {
                  window.open(`/api/quotes/${quote.id}/pdf`, "_blank")
                  setOpen(false)
                }}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                PDF <FileText size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={() => {
                  if (quote.templateId) {
                    router.push(`/dashboard/quotes/templates/${quote.templateId}`)
                  }
                }}
                disabled={!quote.templateId}
                title={quote.templateId ? "" : "No template was used for this quote"}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Quote Template <ExternalLink size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={handleCopyPublicLink}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                {copied ? "Copied!" : "Public Links"} <Link2 size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={() => {
                  onShowRevisions()
                  setOpen(false)
                }}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
              >
                Revisions <History size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-danger hover:bg-surface-hover border-t border-border"
              >
                Delete <Trash2 size={14} />
              </button>
            </>
          )}

          {subPanel === "assign" && (
            <>
              <button
                onClick={() => setSubPanel(null)}
                className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover border-b border-border"
              >
                ← Back
              </button>
              <div className="max-h-48 overflow-y-auto">
                {users.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Loading...</p>
                )}
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAssign(u.id)}
                    className="block w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {subPanel === "status" && (
            <>
              <button
                onClick={() => setSubPanel(null)}
                className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-surface-hover border-b border-border"
              >
                ← Back
              </button>
              {["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleChangeStatus(s)}
                  className="block w-full text-left px-3 py-2 text-foreground hover:bg-surface-hover"
                >
                  {statusLabel(s)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Revisions Modal ────────────────────────────────────────────────────
interface RevisionEntry {
  id: string
  version: number
  status: string
  createdAt: string
  isActive: boolean
}

function RevisionsModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const router = useRouter()
  const [versions, setVersions] = useState<RevisionEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/quotes/${quote.id}/versions`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setVersions(data)
        setLoading(false)
      })
  }, [quote.id])

  return (
    <Modal maxWidth="md">
      <h2 className="text-lg font-bold text-foreground">{quote.quoteNumber} — Revisions</h2>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => router.push(`/dashboard/quotes/${v.id}`)}
              className={`flex items-center justify-between w-full rounded-md px-3 py-2 text-sm text-left ${
                v.id === quote.id ? "bg-muted" : "hover:bg-surface-hover"
              }`}
            >
              <span className="text-foreground">
                v{v.version} · {statusLabel(v.status)}
                <span className="block text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
              </span>
              {v.isActive && <span className="text-xs font-medium text-success">Active</span>}
            </button>
          ))}
          {!loading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground">No revisions found.</p>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
    </Modal>
  )
}

// ─── Templates Tab ────────────────────────────────────────────────────────
function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    introText: "",
    terms: "",
    expiryDays: "30",
  })

  function loadTemplates() {
    fetch("/api/quote-templates")
      .then((res) => res.json())
      .then((json) => {
        setTemplates(json)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  async function handleCreate() {
    if (!newTemplate.name.trim()) return

    await fetch("/api/quote-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTemplate),
    })

    setNewTemplate({ name: "", description: "", introText: "", terms: "", expiryDays: "30" })
    setShowNew(false)
    loadTemplates()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowNew(!showNew)}>
          {showNew ? "Cancel" : "New Template"}
        </Button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-card space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Template Name *</label>
            <input
              type="text"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Description</label>
            <input
              type="text"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Intro Text</label>
            <textarea
              value={newTemplate.introText}
              onChange={(e) => setNewTemplate({ ...newTemplate, introText: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Terms & Conditions</label>
            <textarea
              value={newTemplate.terms}
              onChange={(e) => setNewTemplate({ ...newTemplate, terms: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Default Expiry (days)</label>
            <input
              type="number"
              value={newTemplate.expiryDays}
              onChange={(e) => setNewTemplate({ ...newTemplate, expiryDays: e.target.value })}
              className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button onClick={handleCreate}>Save Template</Button>
        </div>
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/dashboard/quotes/templates/${t.id}`}
            className="block rounded-lg border border-border bg-card p-3 text-sm shadow-card transition-shadow hover:shadow-elevated hover:bg-surface-hover"
          >
            <p className="font-medium text-foreground">{t.name}</p>
            {t.description && <p className="text-muted-foreground">{t.description}</p>}
            <p className="text-muted-foreground text-xs mt-1">Expires after {t.expiryDays} days</p>
          </Link>
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground">No templates yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}

// ─── New Quote Template Picker Modal ──────────────────────────────────────
function TemplatePickerModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/quote-templates")
      .then((res) => res.json())
      .then((json) => {
        setTemplates(json.filter((t: Template) => t.active))
        setLoading(false)
      })
  }, [])

  return (
    <Modal maxWidth="md">
      <h2 className="text-lg font-bold text-foreground">Choose a Template</h2>

        {loading && <p className="text-sm text-muted-foreground">Loading templates...</p>}

        {!loading && templates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No templates yet. Go to the Templates tab to create one before starting a quote.
          </p>
        )}

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/quotes/new?template=${t.id}`}
              className="block rounded-md border border-border p-3 text-sm hover:bg-surface-hover"
            >
              <p className="font-medium text-foreground">{t.name}</p>
              {t.description && <p className="text-muted-foreground">{t.description}</p>}
            </Link>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
    </Modal>
  )
}