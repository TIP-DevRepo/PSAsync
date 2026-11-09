"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Clock, Plus, Ticket, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { TopbarAction } from "@/components/layout/TopbarSlots"
import { LIST_PAGE, PageHeader, StatRow, StatTile, TABLE } from "@/components/ui/blocks"
import { ViewTabs, type ViewTabItem } from "@/components/ui/view-tabs"
import { FilterChip } from "@/components/ui/filter-chip"
import { useAccess } from "@/components/AccessProvider"
import { useColumnFilters } from "@/components/table/ColumnFilters"
import { OpportunityFilterBar } from "@/components/opportunities/OpportunityFilterBar"
import { hasColumnFilters } from "@/lib/column-filters"
import {
  ASSIGNEE_UNASSIGNED,
  pageLinks,
  readTicketPageUrl,
  ticketApiQuery,
  ticketPageQuery,
  TICKET_FILTER_KEYS,
  TICKET_VIEW_LABELS,
  TICKET_VIEWS,
  viewCount,
  type TicketColumnKey,
  type TicketListQuery,
  type TicketStats,
  type TicketView,
} from "@/lib/ticket-list"
import { notifyTicketsChanged, ticketHref, type TicketRow } from "@/lib/ticket-view"
import { cn } from "@/lib/utils"
import { TicketList } from "./TicketList"
import { NewTicketModal } from "./NewTicketModal"
import { useTicketOptions } from "./useTicketOptions"

interface TicketPage {
  tickets: TicketRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  stats: TicketStats
}

const FILTER_ROW_ID = "ticket-column-filters"

// The Tickets list (/dashboard/tickets), as the design draws it: the page
// header with its line of totals, the stat tiles, then one frame holding
// the built in views (My tickets, Unassigned, All open, Waiting, All
// tickets), the assignee chip, the
// search, the table with its column filters, and the pages. Everything the
// list shows is in the URL (view, q, team, assignee, sort, dir, page, and
// f_<column>), and the API pages, sorts, and filters in the database, so a
// refresh or a shared link opens the same page and the list stays fast with
// many tickets. The stat tiles and view counts come from the same request,
// worked out on the server for what the user can see in the queue and
// assignee scope.
export function TicketsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useAccess()
  const canCreate = can("tickets.create")

  const query = useMemo(() => readTicketPageUrl(searchParams), [searchParams])
  const apiQuery = ticketApiQuery(query)
  const options = useTicketOptions()
  const columnFilters = useColumnFilters(TICKET_FILTER_KEYS)

  const [data, setData] = useState<TicketPage | null>(null)
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const loading = loadedQuery !== apiQuery
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const setQuery = useCallback(
    (next: TicketListQuery) => {
      router.replace(`${pathname}${ticketPageQuery(next)}`, { scroll: false })
    },
    [router, pathname]
  )
  // Every change but paging goes back to the first page
  const change = useCallback((patch: Partial<TicketListQuery>) => setQuery({ ...query, page: 1, ...patch }), [setQuery, query])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/tickets${apiQuery}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body || !Array.isArray(body.tickets)) {
          setLoadError((body && typeof body.error === "string" && body.error) || "Couldn't load tickets.")
        } else {
          setData(body)
          setLoadError(null)
        }
        setLoadedQuery(apiQuery)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLoadError("Couldn't load tickets.")
        setLoadedQuery(apiQuery)
      })
    return () => controller.abort()
  }, [apiQuery])

  // A page past the end (the filters changed under it) goes to the last one
  useEffect(() => {
    if (data && !loading && data.total > 0 && query.page > data.pageCount) setQuery({ ...query, page: data.pageCount })
  }, [data, loading, query, setQuery])

  function handleSort(column: TicketColumnKey) {
    // Ascending, then descending, then back to newest first
    if (query.sort !== column) change({ sort: column, dir: "asc" })
    else if (query.dir === "asc") change({ dir: "desc" })
    else change({ sort: "", dir: "asc" })
  }

  const teamName = query.team ? (options.teams.find((t) => t.id === query.team)?.name ?? "Queue") : null
  const assigneeName = !query.assignee
    ? null
    : query.assignee === ASSIGNEE_UNASSIGNED
      ? "Unassigned"
      : (options.users.find((u) => u.id === query.assignee)?.name ?? "Assignee")

  const stats = data?.stats ?? null
  const views: ViewTabItem<TicketView>[] = TICKET_VIEWS.map((key) => ({ key, label: TICKET_VIEW_LABELS[key], count: stats ? viewCount(key, stats) : undefined }))
  const priorityOrders = options.priorities.map((p) => p.sortOrder)
  const scope = [teamName, assigneeName].filter(Boolean).join(", ")
  const filtered = !!query.q.trim() || hasColumnFilters(query.filters)

  return (
    <div className={LIST_PAGE}>
      <Breadcrumbs
        items={teamName ? [{ label: "Tickets", href: pathname }] : []}
        current={teamName ? `${teamName} · ${TICKET_VIEW_LABELS[query.view]}` : "Tickets"}
      />
      {canCreate && (
        <TopbarAction>
          <Button size="lg" className="gap-1.5 px-3.5" onClick={() => setShowNew(true)}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            New ticket
          </Button>
        </TopbarAction>
      )}
      <PageHeader
        title="Tickets"
        subtitle={stats ? `${scope ? `${scope} · ` : ""}${stats.open} open, ${stats.unassigned} unassigned` : scope || "Every ticket you can open, in its queue."}
      />

      {stats && (
        <StatRow label="Ticket totals">
          <StatTile label="Open" value={stats.open} icon={Ticket} tone="accent" />
          <StatTile label="Unassigned" value={stats.unassigned} icon={UserRound} tone="neutral" />
          <StatTile label="Waiting on customer" value={stats.waiting} icon={Clock} tone="warn" />
          <StatTile label={stats.urgentLabel} value={stats.urgent} icon={AlertTriangle} tone="bad" />
        </StatRow>
      )}

      <section aria-label="Tickets" className={TABLE.frame}>
        <div className={TABLE.toolbar}>
          <ViewTabs ariaLabel="Views" views={views} active={query.view} onChange={(view) => change({ view })} />
          <span className="flex-1" />
          {assigneeName && <FilterChip label={`Assignee: ${assigneeName}`} onRemove={() => change({ assignee: "" })} />}
          <OpportunityFilterBar q={query.q} onChange={(q) => change({ q })} label="Search tickets" id="ticket-search" />
        </div>

        {loadError ? (
          <div role="alert" className="p-6 text-center">
            <p className="text-sm font-medium text-foreground">{loadError}</p>
          </div>
        ) : !data ? (
          <p className="p-6 text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <TicketList
              tickets={data.tickets}
              sort={query.sort}
              dir={query.dir}
              onSort={handleSort}
              columnFilters={columnFilters}
              filterRowId={FILTER_ROW_ID}
              priorityOrders={priorityOrders}
              loading={loading}
              emptyMessage={
                filtered ? (
                  <>
                    No tickets match these filters.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        columnFilters.clear()
                        change({ q: "", filters: {} })
                      }}
                      className="font-medium text-acc-ink hover:underline"
                    >
                      Clear filters
                    </button>
                  </>
                ) : query.view === "all" ? (
                  "No tickets yet."
                ) : (
                  `Nothing in ${TICKET_VIEW_LABELS[query.view]} right now.`
                )
              }
            />
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={(page) => setQuery({ ...query, page })} />
          </>
        )}
      </section>

      {showNew && (
        <NewTicketModal
          options={options}
          onClose={() => setShowNew(false)}
          onCreated={(ticket) => {
            notifyTicketsChanged()
            router.push(ticketHref(ticket.id))
          }}
        />
      )}
    </div>
  )
}

// Numbered pages, kept in the URL (?page=), with the first, last, current,
// and neighboring pages shown and gaps as "..."
function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  if (total === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  const button = "inline-flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3.5 py-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        Showing {first} to {last} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={cn(button, "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
            Previous
          </button>
          {pageLinks(page, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
                ...
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={cn(button, n === page ? "bg-acc-tint font-semibold text-acc-ink" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}
              >
                {n}
              </button>
            )
          )}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} className={cn(button, "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
            Next
          </button>
        </div>
      )}
    </nav>
  )
}
