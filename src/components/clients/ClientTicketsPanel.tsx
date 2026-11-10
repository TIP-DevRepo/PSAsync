"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InitialsAvatar, TABLE } from "@/components/ui/blocks"
import { ViewTabs } from "@/components/ui/view-tabs"
import { useAccess } from "@/components/AccessProvider"
import { useRowDensity } from "@/components/AppearanceProvider"
import { TicketPriorityMarker, TicketStatusPill } from "@/components/tickets/TicketPills"
import { NewTicketModal } from "@/components/tickets/NewTicketModal"
import { useTicketOptions } from "@/components/tickets/useTicketOptions"
import { cn } from "@/lib/utils"
import {
  CLIENT_TICKET_FILTER_LABELS,
  CLIENT_TICKET_FILTERS,
  notifyTicketsChanged,
  relativeTime,
  ticketHref,
  type ClientTicketFilter,
  type TicketRow,
} from "@/lib/ticket-view"

const COLUMNS = [
  { key: "number", label: "Ticket", width: 140 },
  { key: "title", label: "Title", width: 300 },
  { key: "status", label: "Status", width: 170 },
  { key: "priority", label: "Priority", width: 130 },
  { key: "assignee", label: "Assignee", width: 190 },
  { key: "updated", label: "Updated", width: 130 },
] as const
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0)

// The client page's Tickets tab (shown with pages.tickets): the client's
// tickets the user may open (GET /api/clients/[id]/tickets, the Tickets
// list's visibility), newest first, filtered to Open (Open and Waiting),
// Closed (Resolved and Closed), or All, with Load more for the next page.
// New ticket (tickets.create) opens the New ticket dialog on this client.
export function ClientTicketsPanel({ client }: { client: { id: string; name: string } }) {
  const router = useRouter()
  const { access, can } = useAccess()
  const myUserId = access?.userId ?? null
  const canCreate = can("tickets.create")
  const density = useRowDensity()
  const [filter, setFilter] = useState<ClientTicketFilter>("open")
  const [rows, setRows] = useState<TicketRow[]>([])
  const [page, setPage] = useState(1)
  const [pageCountState, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const options = useTicketOptions()
  const priorityOrders = options.priorities.map((p) => p.sortOrder)
  const key = `${client.id}#${filter}`

  const load = useCallback(
    (nextPage: number) => {
      fetch(`/api/clients/${client.id}/tickets?status=${filter}&page=${nextPage}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
        .then((data: { tickets: TicketRow[]; total: number; page: number; pageCount: number }) => {
          setRows((prev) => (nextPage === 1 ? data.tickets : [...prev, ...data.tickets.filter((t) => !prev.some((p) => p.id === t.id))]))
          setPage(data.page)
          setPageCount(data.pageCount)
          setTotal(data.total)
          setFailed(false)
          setLoadedKey(key)
        })
        .catch(() => {
          setFailed(true)
          setLoadedKey(key)
        })
    },
    [client.id, filter, key]
  )

  useEffect(() => {
    load(1)
  }, [load])

  const loading = loadedKey !== key
  const now = new Date()
  const cell = `${density === "compact" ? "py-1.5" : density === "comfortable" ? "py-5" : "py-3"} ${TABLE.cellX} overflow-hidden`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          ariaLabel="Ticket status"
          views={CLIENT_TICKET_FILTERS.map((k) => ({ key: k, label: CLIENT_TICKET_FILTER_LABELS[k], count: k === filter && !loading ? total : undefined }))}
          active={filter}
          onChange={setFilter}
        />
        {canCreate && (
          <Button onClick={() => setShowNew(true)} className="gap-1">
            <Plus size={14} aria-hidden="true" />
            New ticket
          </Button>
        )}
      </div>

      <section aria-label={`${client.name} tickets`} className={TABLE.frame}>
        {failed ? (
          <p role="alert" className="p-6 text-sm text-muted-foreground">
            Couldn&apos;t load this client&apos;s tickets. Refresh to try again.
          </p>
        ) : (
          <div className={TABLE.scroll}>
            <table className={TABLE.table} style={{ minWidth: TABLE_MIN_WIDTH }} aria-busy={loading}>
              <colgroup>
                {COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
              </colgroup>
              <thead>
                <tr className={TABLE.headRow}>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className={TABLE.th}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={cn(loading && "opacity-60")}>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) return
                      router.push(ticketHref(t.id))
                    }}
                    className={cn("cursor-pointer", TABLE.row)}
                  >
                    <td className={cn(cell, TABLE.number)}>
                      <Link href={ticketHref(t.id)} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t.number}
                      </Link>
                    </td>
                    <td className={cn(cell, "truncate font-medium text-foreground")} title={t.title}>
                      {t.title}
                    </td>
                    <td className={cell}>
                      <TicketStatusPill name={t.status.name} category={t.status.category} />
                    </td>
                    <td className={cell}>
                      <TicketPriorityMarker name={t.priority.name} sortOrder={t.priority.sortOrder} allOrders={priorityOrders} />
                    </td>
                    <td className={cell}>
                      <span className="flex min-w-0 items-center gap-2 text-[13px]">
                        <InitialsAvatar name={t.assignee?.name ?? null} tone={t.assignee ? (t.assignee.id === myUserId ? "solid" : "accent") : "neutral"} size="sm" />
                        <span className={cn("truncate", t.assignee ? "text-foreground" : "text-muted-foreground")}>{t.assignee?.name ?? "Unassigned"}</span>
                      </span>
                    </td>
                    <td className={cn(cell, "text-[13px] text-muted-foreground")}>
                      <time dateTime={t.updatedAt} title={new Date(t.updatedAt).toLocaleString()}>
                        {relativeTime(t.updatedAt, now)}
                      </time>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {filter === "open" ? "No open tickets for this client." : filter === "closed" ? "No closed tickets for this client." : "No tickets for this client yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!failed && page < pageCountState && (
          <div className="flex justify-center border-t border-border px-3.5 py-3">
            <Button variant="outline" onClick={() => load(page + 1)}>
              Load more
            </Button>
          </div>
        )}
      </section>

      {showNew && (
        <NewTicketModal
          options={options}
          client={client}
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
