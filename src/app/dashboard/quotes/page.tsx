"use client"

import { useState, useEffect, useRef, useLayoutEffect } from "react"
import { useFixedMenuPosition, useCloseOnOutsideClick, useCloseOnScroll } from "@/lib/useFixedMenu"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Pencil, Mail, Search, Flag, MessageSquare, MoreVertical, UserPlus, Copy, Workflow, FileText, ExternalLink, Link2, History, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import { Modal } from "@/components/Modal"

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
  DRAFT: "bg-zinc-100 text-zinc-600",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
  SENT: "bg-blue-100 text-blue-800",
  VIEWED: "bg-purple-100 text-purple-800",
  ACCEPTED: "bg-green-100 text-green-800",
  DECLINED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
}

const STAGE_BAR_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-300",
  PENDING_APPROVAL: "bg-yellow-400",
  SENT: "bg-orange-400",
  VIEWED: "bg-blue-400",
  ACCEPTED: "bg-green-500",
  DECLINED: "bg-red-400",
  EXPIRED: "bg-orange-300",
}

// How far along the pipeline each status is, for the progress bar
const STAGE_PROGRESS: Record<string, number> = {
  DRAFT: 10,
  PENDING_APPROVAL: 25,
  SENT: 40,
  VIEWED: 65,
  ACCEPTED: 100,
  DECLINED: 100,
  EXPIRED: 100,
}

// Internal-facing display rename: Accepted -> Approved, Declined -> Lost
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
        className={`flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${align === "right" ? "ml-auto" : ""}`}
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
// Sliding indicator, full keyboard nav, ARIA roles, and a short crossfade
// on content switch, per the Tabs System pattern in the design rules doc.
// Mobile segmented-control treatment (under 5 tabs) is a separate visual
// decision, deliberately deferred — documented, not guessed at here.
type TabKey = "scorecard" | "quotes" | "templates"

const TOP_TABS: { key: TabKey; label: string }[] = [
  { key: "scorecard", label: "Scorecard" },
  { key: "quotes", label: "Quotes" },
  { key: "templates", label: "Templates" },
]

function TabsBar({ activeTab, onChange }: { activeTab: TabKey; onChange: (key: TabKey) => void }) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const btn = tabRefs.current[activeTab]
    if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [activeTab])

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    let nextIdx = idx
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % TOP_TABS.length
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TOP_TABS.length) % TOP_TABS.length
    else if (e.key === "Home") nextIdx = 0
    else if (e.key === "End") nextIdx = TOP_TABS.length - 1
    else return
    e.preventDefault()
    const nextKey = TOP_TABS[nextIdx].key
    onChange(nextKey)
    tabRefs.current[nextKey]?.focus()
  }

  return (
    <div role="tablist" aria-label="Quotes sections" className="relative flex gap-4 border-b text-sm">
      {TOP_TABS.map((tab, idx) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[tab.key] = el
            }}
            role="tab"
            id={`quotes-tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`quotes-tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`pb-2 rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
              isActive ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        )
      })}
      <div
        className="absolute bottom-0 h-0.5 bg-zinc-900 dark:bg-zinc-100 transition-[left,width] duration-300"
        style={{ left: indicator.left, width: indicator.width, transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function QuotesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("quotes")
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  // Crossfade: fade out the old tab's content, pause briefly, then swap
  // content and fade in — never a hard instant cut.
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
        <h1 className="text-2xl font-bold">Quotes</h1>
        <Button onClick={() => setShowTemplatePicker(true)}>New Quote</Button>
      </div>

      <TabsBar activeTab={activeTab} onChange={setActiveTab} />

      <div
        role="tabpanel"
        id={`quotes-tabpanel-${displayedTab}`}
        aria-labelledby={`quotes-tab-${displayedTab}`}
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

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>
  if (!data) return <p className="text-sm text-red-600">Could not load scorecard.</p>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-md border p-4">
          <p className="text-xs text-zinc-500">Total Quotes</p>
          <p className="text-2xl font-bold">{data.totalQuotes}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs text-zinc-500">Total Value</p>
          <p className="text-2xl font-bold">${data.totalValue.toFixed(2)}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs text-zinc-500">Approved Value</p>
          <p className="text-2xl font-bold">${data.acceptedValue.toFixed(2)}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs text-zinc-500">Approved Quotes</p>
          <p className="text-2xl font-bold">{data.counts.ACCEPTED ?? 0}</p>
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h3 className="font-semibold text-sm mb-3">By Status</h3>
        <div className="space-y-2">
          {Object.entries(data.counts).map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-sm">
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}>
                {statusLabel(status)}
              </span>
              <span className="font-medium">{count}</span>
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

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>

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

  async function handleToggleFlag(quoteId: string) {
    setQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, flagged: !q.flagged } : q)))
    await fetch(`/api/quotes/${quoteId}/flag`, { method: "POST" })
  }

  async function handleBulkSubmit() {
    if (!bulkAction || selected.size === 0) return

    if (bulkAction === "delete") {
      if (!confirm(`Delete ${selected.size} quote(s) permanently?`)) return
      await Promise.all(
        Array.from(selected).map((id) => fetch(`/api/quotes/${id}`, { method: "DELETE" }))
      )
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
            onChange={(e) => setBulkAction(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
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
            onChange={(e) => setDensity(e.target.value as Density)}
            className="rounded-md border px-3 py-2 text-sm"
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
          className="w-64 rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
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

      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-md border">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-950">
            <tr className="border-b text-left text-xs text-zinc-500">
              <th className="py-2 pr-2 w-8">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="py-2 pr-3">Owner</th>
              <SortableHeader label="Number" column="number" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Customer" column="customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Stage" column="stage" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="Last Sent Date" column="sentAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Expiry Date" column="expiresAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Won Date" column="acceptedAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((quote) => (
              <tr
                key={quote.id}
                onClick={() => toggleSelected(quote.id)}
                className={`border-b cursor-pointer align-top ${
                  selected.has(quote.id) ? "bg-zinc-50 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                }`}
              >
                <td className={`${ROW_PADDING[density]} pr-2`} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(quote.id)}
                    onChange={() => toggleSelected(quote.id)}
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
                    className="font-medium hover:underline text-left"
                  >
                    {quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber}
                  </button>
                  {quote.draftVersionId && (
                    <div
                      title={`Version ${quote.draftVersionNumber} draft in progress`}
                      className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    >
                      Draft v{quote.draftVersionNumber} in progress
                    </div>
                  )}
                </td>
                <td className={`${ROW_PADDING[density]} pr-3`}>
                  <p className="font-medium">{quote.contactName ?? quote.clientName}</p>
                  {quote.contactName && <p className="text-xs text-zinc-500">{quote.clientName}</p>}
                </td>
                <td className={`${ROW_PADDING[density]} pr-3`}>{quote.title ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} pr-3 w-40`}>
                  <p className="text-xs font-medium mb-1">{statusLabel(quote.status)}</p>
                  <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-1.5 rounded-full ${STAGE_BAR_COLORS[quote.status]}`}
                      style={{ width: `${STAGE_PROGRESS[quote.status] ?? 0}%` }}
                    />
                  </div>
                </td>
                <td className={`${ROW_PADDING[density]} pr-3 text-right tabular-nums`}>${quote.total.toFixed(2)}</td>
                <td className={`${ROW_PADDING[density]} pr-3`}>{fmtDate(quote.sentAt)}</td>
                <td className={`${ROW_PADDING[density]} pr-3`}>{fmtDate(quote.expiresAt)}</td>
                <td className={`${ROW_PADDING[density]} pr-3`}>{fmtDate(quote.acceptedAt)}</td>
                <td className={`${ROW_PADDING[density]} pr-3`} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2 relative">
                    <button
                      title="Edit"
                      onClick={() => router.push(`/dashboard/quotes/${quote.id}`)}
                      className="text-zinc-400 hover:text-zinc-900"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      title="Send Quote"
                      onClick={() => router.push(`/dashboard/quotes/${quote.id}?send=1`)}
                      className="text-zinc-400 hover:text-zinc-900"
                    >
                      <Mail size={15} />
                    </button>
                    <button
                      title="View Portal"
                      onClick={() => window.open(`/portal/${quote.accessToken}`, "_blank")}
                      className="text-zinc-400 hover:text-zinc-900"
                    >
                      <Search size={15} />
                    </button>
                    <button
                      title={quote.flagged ? "Unflag" : "Flag for follow-up"}
                      onClick={() => handleToggleFlag(quote.id)}
                      className={quote.flagged ? "text-amber-500" : "text-zinc-400 hover:text-zinc-900"}
                    >
                      <Flag size={15} fill={quote.flagged ? "currentColor" : "none"} />
                    </button>
                    <button
                      title="Comments"
                      onClick={() => setCommentsFor(quote)}
                      className="relative text-zinc-400 hover:text-zinc-900"
                    >
                      <MessageSquare size={15} />
                      {quote.hasUnreadComment && (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
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
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-zinc-500">
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
    // Mark viewed as soon as the thread is opened, clearing the badge
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
      <h2 className="text-lg font-bold">{quote.quoteNumber} — Comments</h2>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {loading && <p className="text-sm text-zinc-500">Loading...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-sm text-zinc-500">No messages yet.</p>
        )}
        {comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-md p-3 text-sm max-w-[85%] ${
              c.authorType === "INTERNAL"
                ? "bg-zinc-100 dark:bg-zinc-800 ml-auto"
                : "bg-blue-50 dark:bg-blue-950"
            }`}
          >
            <p className="text-xs font-medium text-zinc-500 mb-1">
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
          className="flex-1 rounded-md border px-3 py-2 text-sm"
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
      <h2 className="text-lg font-bold">
          {quote.quoteNumber} has a draft in progress
        </h2>
        <p className="text-sm text-zinc-500">
          Version {quote.version} is the current live quote. Version {quote.draftVersionNumber} is
          a draft revision that hasn&apos;t been sent yet. Which would you like to open?
        </p>
        <div className="space-y-2">
          <button
            onClick={() => router.push(`/dashboard/quotes/${quote.id}`)}
            className="w-full rounded-md border p-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <p className="font-medium">View Current Live Quote</p>
            <p className="text-xs text-zinc-500">v{quote.version} · {statusLabel(quote.status)}</p>
          </button>
          <button
            onClick={() => router.push(`/dashboard/quotes/${quote.draftVersionId}`)}
            className="w-full rounded-md border p-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <p className="font-medium">Work on New Version Draft</p>
            <p className="text-xs text-zinc-500">v{quote.draftVersionNumber} · Draft</p>
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
    if (!confirm("Delete this quote permanently?")) return
    const res = await fetch(`/api/quotes/${quote.id}`, { method: "DELETE" })
    if (res.ok) {
      onDeleted()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || "Couldn't delete this quote.")
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        title="More"
        onClick={toggleOpen}
        className="text-zinc-400 hover:text-zinc-900"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-50 w-56 rounded-md border bg-white dark:bg-zinc-900 shadow-md text-sm overflow-hidden"
        >
          {subPanel === null && (
            <>
              <button
                onClick={openAssign}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Assign <UserPlus size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={handleCopyQuote}
                disabled={copying}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {copying ? "Copying..." : "Copy"} <Copy size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={() => setSubPanel("status")}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Change Status <Workflow size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={() => {
                  window.open(`/api/quotes/${quote.id}/pdf`, "_blank")
                  setOpen(false)
                }}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                PDF <FileText size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={() => {
                  if (quote.templateId) {
                    router.push(`/dashboard/quotes/templates/${quote.templateId}`)
                  }
                }}
                disabled={!quote.templateId}
                title={quote.templateId ? "" : "No template was used for this quote"}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Quote Template <ExternalLink size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={handleCopyPublicLink}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {copied ? "Copied!" : "Public Links"} <Link2 size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={() => {
                  onShowRevisions()
                  setOpen(false)
                }}
                className="flex items-center justify-between w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Revisions <History size={14} className="text-zinc-400" />
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-red-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-t"
              >
                Delete <Trash2 size={14} />
              </button>
            </>
          )}

          {subPanel === "assign" && (
            <>
              <button
                onClick={() => setSubPanel(null)}
                className="w-full text-left px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b"
              >
                ← Back
              </button>
              <div className="max-h-48 overflow-y-auto">
                {users.length === 0 && (
                  <p className="px-3 py-2 text-xs text-zinc-500">Loading...</p>
                )}
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAssign(u.id)}
                    className="block w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                className="w-full text-left px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b"
              >
                ← Back
              </button>
              {["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleChangeStatus(s)}
                  className="block w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
      <h2 className="text-lg font-bold">{quote.quoteNumber} — Revisions</h2>

        {loading && <p className="text-sm text-zinc-500">Loading...</p>}

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => router.push(`/dashboard/quotes/${v.id}`)}
              className={`flex items-center justify-between w-full rounded-md px-3 py-2 text-sm text-left ${
                v.id === quote.id ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <span>
                v{v.version} · {statusLabel(v.status)}
                <span className="block text-xs text-zinc-500">{new Date(v.createdAt).toLocaleDateString()}</span>
              </span>
              {v.isActive && <span className="text-xs font-medium text-green-600">Active</span>}
            </button>
          ))}
          {!loading && versions.length === 0 && (
            <p className="text-sm text-zinc-500">No revisions found.</p>
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

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowNew(!showNew)}>
          {showNew ? "Cancel" : "New Template"}
        </Button>
      </div>

      {showNew && (
        <div className="rounded-md border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Template Name *</label>
            <input
              type="text"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Intro Text</label>
            <textarea
              value={newTemplate.introText}
              onChange={(e) => setNewTemplate({ ...newTemplate, introText: e.target.value })}
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Terms & Conditions</label>
            <textarea
              value={newTemplate.terms}
              onChange={(e) => setNewTemplate({ ...newTemplate, terms: e.target.value })}
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Expiry (days)</label>
            <input
              type="number"
              value={newTemplate.expiryDays}
              onChange={(e) => setNewTemplate({ ...newTemplate, expiryDays: e.target.value })}
              className="w-32 rounded-md border px-3 py-2 text-sm"
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
            className="block rounded-md border p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <p className="font-medium">{t.name}</p>
            {t.description && <p className="text-zinc-500">{t.description}</p>}
            <p className="text-zinc-500 text-xs mt-1">Expires after {t.expiryDays} days</p>
          </Link>
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-zinc-500">No templates yet. Create one above.</p>
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
      <h2 className="text-lg font-bold">Choose a Template</h2>

        {loading && <p className="text-sm text-zinc-500">Loading templates...</p>}

        {!loading && templates.length === 0 && (
          <p className="text-sm text-zinc-500">
            No templates yet. Go to the Templates tab to create one before starting a quote.
          </p>
        )}

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/quotes/new?template=${t.id}`}
              className="block rounded-md border p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <p className="font-medium">{t.name}</p>
              {t.description && <p className="text-zinc-500">{t.description}</p>}
            </Link>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
    </Modal>
  )
}