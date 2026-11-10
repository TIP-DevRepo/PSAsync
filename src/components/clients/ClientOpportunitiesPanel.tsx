"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { InitialsAvatar, TABLE } from "@/components/ui/blocks"
import { ViewTabs } from "@/components/ui/view-tabs"
import { useAccess } from "@/components/AccessProvider"
import { useRowDensity } from "@/components/AppearanceProvider"
import { StagePill } from "@/components/opportunities/StagePill"
import { cn } from "@/lib/utils"
import { relativeTime } from "@/lib/ticket-view"
import { opportunityDisplayValue } from "@/lib/opportunity-value"
import {
  CLIENT_OPPORTUNITY_FILTER_LABELS,
  CLIENT_OPPORTUNITY_FILTERS,
  formatCents,
  formatDateOnly,
  opportunityHref,
  valueCents,
  type ClientOpportunityFilter,
  type OpportunityRow,
} from "@/lib/opportunity-view"

// The Opportunities list's columns that make sense on one client's page
// (no Client column), at the same fixed widths
const COLUMNS = [
  { key: "number", label: "Number", width: 150 },
  { key: "title", label: "Title", width: 280 },
  { key: "stage", label: "Stage", width: 160 },
  { key: "owner", label: "Owner", width: 180 },
  { key: "value", label: "Value", width: 140 },
  { key: "expectedClose", label: "Expected close", width: 140 },
  { key: "updated", label: "Updated", width: 130 },
] as const
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0)

const EMPTY_TEXT: Record<ClientOpportunityFilter, string> = {
  open: "No open opportunities for this client.",
  won: "No won opportunities for this client.",
  lost: "No lost opportunities for this client.",
  all: "No opportunities for this client yet.",
}

// The client page's Opportunities tab (shown with pages.opportunities): the
// client's opportunities the user may open (GET
// /api/clients/[id]/opportunities, the Opportunities list's team
// visibility), newest first, filtered to Open, Won, Lost, or All, with Load
// more for the next page. Value is the list's value (the latest linked
// quote's total, else the expected value). A row opens the opportunity.
export function ClientOpportunitiesPanel({ client }: { client: { id: string; name: string } }) {
  const router = useRouter()
  const { access } = useAccess()
  const myUserId = access?.userId ?? null
  const density = useRowDensity()
  const [filter, setFilter] = useState<ClientOpportunityFilter>("open")
  const [rows, setRows] = useState<OpportunityRow[]>([])
  const [page, setPage] = useState(1)
  const [pageCountState, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const key = `${client.id}#${filter}`

  const load = useCallback(
    (nextPage: number) => {
      fetch(`/api/clients/${client.id}/opportunities?status=${filter}&page=${nextPage}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
        .then((data: { opportunities: OpportunityRow[]; total: number; page: number; pageCount: number }) => {
          setRows((prev) => (nextPage === 1 ? data.opportunities : [...prev, ...data.opportunities.filter((o) => !prev.some((p) => p.id === o.id))]))
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
      <ViewTabs
        ariaLabel="Opportunity stage"
        views={CLIENT_OPPORTUNITY_FILTERS.map((k) => ({ key: k, label: CLIENT_OPPORTUNITY_FILTER_LABELS[k], count: k === filter && !loading ? total : undefined }))}
        active={filter}
        onChange={setFilter}
      />

      <section aria-label={`${client.name} opportunities`} className={TABLE.frame}>
        {failed ? (
          <p role="alert" className="p-6 text-sm text-muted-foreground">
            Couldn&apos;t load this client&apos;s opportunities. Refresh to try again.
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
                    <th key={c.key} scope="col" className={cn(TABLE.th, c.key === "value" && "text-right")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={cn(loading && "opacity-60")}>
                {rows.map((o) => {
                  const value = opportunityDisplayValue(o)
                  return (
                    <tr
                      key={o.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return
                        router.push(opportunityHref(o.id))
                      }}
                      className={cn("cursor-pointer", TABLE.row)}
                    >
                      <td className={cn(cell, TABLE.number)}>
                        <Link href={opportunityHref(o.id)} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {o.number}
                        </Link>
                      </td>
                      <td className={cn(cell, "truncate font-medium text-foreground")} title={o.title}>
                        {o.title}
                      </td>
                      <td className={cell}>
                        <StagePill name={o.stage.name} category={o.stage.category} />
                      </td>
                      <td className={cell}>
                        <span className="flex min-w-0 items-center gap-2 text-[13px]">
                          <InitialsAvatar name={o.owner?.name ?? null} tone={o.owner ? (o.owner.id === myUserId ? "solid" : "accent") : "neutral"} size="sm" />
                          <span className={cn("truncate", o.owner ? "text-foreground" : "text-muted-foreground")}>{o.owner?.name ?? "Unassigned"}</span>
                        </span>
                      </td>
                      <td className={cn(cell, "text-right tabular-nums text-foreground")} title={o.quoteValue ? o.quoteValue.label : undefined}>
                        {value === null ? "-" : formatCents(valueCents(value))}
                      </td>
                      <td className={cn(cell, "text-[13px] text-foreground")}>{formatDateOnly(o.expectedCloseDate)}</td>
                      <td className={cn(cell, "text-[13px] text-muted-foreground")}>
                        <time dateTime={o.updatedAt} title={new Date(o.updatedAt).toLocaleString()}>
                          {relativeTime(o.updatedAt, now)}
                        </time>
                      </td>
                    </tr>
                  )
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {EMPTY_TEXT[filter]}
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
    </div>
  )
}
