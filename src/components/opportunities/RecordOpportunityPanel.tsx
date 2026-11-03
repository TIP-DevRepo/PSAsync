"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import type { OpportunityRelated, RelatedRecord } from "@/lib/opportunity-related"
import type { StageCategoryName } from "@/lib/opportunity-quote-rules"
import { StagePill } from "./StagePill"

// GET /api/quotes/[id]/opportunity, /api/sales-orders/[id]/opportunity, or
// /api/purchase-orders/[id]/opportunity
export interface RecordOpportunityPanelData {
  linked: boolean
  opportunity: {
    id: string
    number: string
    title: string
    stage: { id: string; name: string; category: StageCategoryName }
    team: { id: string; name: string } | null
    owner: { id: string; name: string } | null
  } | null
  related: OpportunityRelated | null
}

export function useRecordOpportunityPanel(url: string) {
  const [state, setState] = useState<{ url: string; data: RecordOpportunityPanelData | null; failed: boolean } | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
      .then((data: RecordOpportunityPanelData) => !cancelled && setState({ url, data, failed: false }))
      .catch(() => !cancelled && setState({ url, data: null, failed: true }))
    return () => {
      cancelled = true
    }
  }, [url, version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const ready = state?.url === url
  return { data: ready ? state.data : null, failed: ready && state.failed, loading: !ready, reload }
}

const SECTIONS: { key: keyof OpportunityRelated; label: string; href: (id: string) => string }[] = [
  { key: "quotes", label: "Quotes", href: (id) => `/dashboard/quotes/${id}` },
  { key: "salesOrders", label: "Sales orders", href: (id) => `/dashboard/sales-orders/${id}` },
  { key: "purchaseOrders", label: "Purchase orders", href: (id) => `/dashboard/purchase-orders/${id}` },
]

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// The Opportunity panel on a quote, sales order, or purchase order page: the
// linked opportunity (number, title, stage, team, owner) with a link, and
// its other linked records the user may open (the same view and cost rules
// as the opportunity's Related tab). currentId leaves this record itself
// out. children hold the page's own controls (the link picker, or Create
// opportunity on a sent quote).
export function RecordOpportunityPanel({
  data,
  failed,
  loading,
  currentId,
  children,
}: {
  data: RecordOpportunityPanelData | null
  failed: boolean
  loading: boolean
  currentId: string
  children?: ReactNode
}) {
  const o = data?.opportunity ?? null
  const others = (key: keyof OpportunityRelated): RelatedRecord[] => (data?.related?.[key] ?? []).filter((r) => r.id !== currentId)
  const otherCount = SECTIONS.reduce((sum, s) => sum + others(s.key).length, 0)

  return (
    <section aria-labelledby="record-opportunity-heading" className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm shadow-card">
      <h2 id="record-opportunity-heading" className="text-sm font-semibold text-foreground">
        Opportunity
      </h2>
      {failed ? (
        <p className="text-muted-foreground">Couldn&apos;t load the opportunity.</p>
      ) : loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : o ? (
        <div className="space-y-2">
          <div className="min-w-0">
            <Link href={`/dashboard/opportunities/${o.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {o.number}
            </Link>
            <p className="break-words text-foreground">{o.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StagePill name={o.stage.name} category={o.stage.category} />
            {o.team && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{o.team.name}</span>}
          </div>
          <p className="text-xs text-muted-foreground">Owner: {o.owner?.name ?? "Unassigned"}</p>
          {otherCount > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              {SECTIONS.map((section) =>
                others(section.key).length === 0 ? null : (
                  <div key={section.key} className="space-y-1">
                    <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{section.label}</h3>
                    <ul className="space-y-1">
                      {others(section.key).map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <Link href={section.href(r.id)} className="truncate text-primary hover:underline">
                            {r.number}
                          </Link>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{r.total === undefined ? "-" : money(r.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ) : data?.linked ? (
        <p className="text-muted-foreground">Linked to an opportunity you don&apos;t have access to.</p>
      ) : (
        <p className="text-muted-foreground">Not linked to an opportunity.</p>
      )}
      {children}
    </section>
  )
}
