"use client"

import { useEffect, useState } from "react"
import { useAccess } from "@/components/AccessProvider"
import { CATEGORY_LABELS } from "@/lib/opportunity-rules"
import type { StageCategoryName } from "@/lib/opportunity-quote-rules"

// One opportunity a record may link to (GET /api/opportunities/linkable)
export interface LinkableOpportunity {
  id: string
  number: string
  title: string
  clientId: string
  contactId: string
  stage: { id: string; name: string; category: StageCategoryName }
  team: { id: string; name: string } | null
}

// The opportunity a record is already linked to, shown even when it is no
// longer in the list (closed since, or out of the user's sight)
export interface CurrentOpportunity {
  id: string
  label: string
}

export function opportunityOptionLabel(o: LinkableOpportunity): string {
  const stage = o.stage.category === "OPEN" ? o.stage.name : `${o.stage.name}, ${CATEGORY_LABELS[o.stage.category]}`
  return `${o.number} ${o.title} (${stage}${o.team ? `, ${o.team.name}` : ""})`
}

const SELECT =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

// The optional Opportunity field on the quote, copy, sales order, and
// purchase order forms. For a quote it lists the OPEN opportunities of the
// quote's client and contact the user may open; for an order, any stage, of
// the client when there is one. Each shows its number, title, stage, and
// team. The server checks the choice again when it is saved. Hidden for
// users without the Opportunities page, who can't open any.
export function OpportunityPicker({
  record,
  clientId,
  contactId = null,
  value,
  onChange,
  current = null,
  disabled = false,
  label = "Opportunity",
  id = "opportunity-picker",
}: {
  record: "quote" | "order"
  clientId: string | null
  contactId?: string | null
  value: string | null
  onChange: (opportunityId: string | null) => void
  current?: CurrentOpportunity | null
  disabled?: boolean
  label?: string
  id?: string
}) {
  const { can } = useAccess()
  const allowed = can("pages.opportunities")
  const ready = record === "quote" ? !!clientId && !!contactId : true
  const query = `for=${record}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}${contactId ? `&contactId=${encodeURIComponent(contactId)}` : ""}`
  const [loaded, setLoaded] = useState<{ query: string; options: LinkableOpportunity[] } | null>(null)

  useEffect(() => {
    if (!allowed || !ready) return
    let cancelled = false
    fetch(`/api/opportunities/linkable?${query}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => !cancelled && setLoaded({ query, options: Array.isArray(data) ? data : [] }))
      .catch(() => !cancelled && setLoaded({ query, options: [] }))
    return () => {
      cancelled = true
    }
  }, [allowed, ready, query])

  if (!allowed) return null
  const options = loaded?.query === query ? loaded.options : null
  const showCurrent = current && !(options ?? []).some((o) => o.id === current.id)

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label} (optional)
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || !ready || options === null}
        className={SELECT}
      >
        <option value="">{!ready ? (record === "quote" ? "Choose a contact first" : "Choose a client first") : options === null ? "Loading..." : "No opportunity"}</option>
        {showCurrent && <option value={current.id}>{current.label}</option>}
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {opportunityOptionLabel(o)}
          </option>
        ))}
      </select>
      {ready && options !== null && options.length === 0 && !current && (
        <p className="mt-1 text-xs text-muted-foreground">
          {record === "quote" ? "No open opportunities for this client and contact." : "No opportunities for this client."}
        </p>
      )}
    </div>
  )
}
