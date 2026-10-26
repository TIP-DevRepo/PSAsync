"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { OpportunityRelated, RelatedRecord } from "@/lib/opportunity-related"

// Quote statuses read the way the quotes list shows them
const QUOTE_STATUS_LABELS: Record<string, string> = { ACCEPTED: "Approved", DECLINED: "Lost" }

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SECTIONS: { key: keyof OpportunityRelated; label: string; href: (id: string) => string; status: (s: string) => string }[] = [
  { key: "quotes", label: "Quotes", href: (id) => `/dashboard/quotes/${id}`, status: (s) => QUOTE_STATUS_LABELS[s] ?? statusLabel(s) },
  { key: "salesOrders", label: "Sales orders", href: (id) => `/dashboard/sales-orders/${id}`, status: statusLabel },
  { key: "purchaseOrders", label: "Purchase orders", href: (id) => `/dashboard/purchase-orders/${id}`, status: statusLabel },
]

// Linked quotes, sales orders, and purchase orders, only the ones this user
// may open (the related route filters them). linkedCount is every link,
// visible or not, from the opportunity itself.
export function OpportunityRelatedPanel({ opportunityId, linkedCount }: { opportunityId: string; linkedCount: number }) {
  const [related, setRelated] = useState<OpportunityRelated | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/api/opportunities/${opportunityId}/related`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
      .then((data: OpportunityRelated) => setRelated(data))
      .catch(() => setFailed(true))
  }, [opportunityId])

  const shown = related ? related.quotes.length + related.salesOrders.length + related.purchaseOrders.length : 0

  return (
    <section aria-labelledby="opportunity-related-heading" className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 id="opportunity-related-heading" className="text-sm font-semibold text-foreground">
        Related
      </h2>
      {failed ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load related records.</p>
      ) : !related ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : shown === 0 ? (
        <p className="text-sm text-muted-foreground">
          {linkedCount > 0
            ? "This opportunity is linked to records you don't have access to."
            : "Nothing is linked yet. Quotes, sales orders, and purchase orders for this opportunity will show here."}
        </p>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) =>
            related[section.key].length === 0 ? null : (
              <div key={section.key} className="space-y-1.5">
                <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{section.label}</h3>
                <ul className="space-y-1.5">
                  {related[section.key].map((record: RelatedRecord) => (
                    <li key={record.id} className="rounded-md border border-border p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={section.href(record.id)} className="truncate font-medium text-primary hover:underline">
                          {record.number}
                        </Link>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{section.status(record.status)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate" title={record.name ?? undefined}>
                          {record.name ?? "-"}
                        </span>
                        <span className="shrink-0 tabular-nums">{record.total === undefined ? "-" : money(record.total)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
          {shown < linkedCount && <p className="text-xs text-muted-foreground">Some linked records are hidden because you don&apos;t have access to them.</p>}
        </div>
      )}
    </section>
  )
}
