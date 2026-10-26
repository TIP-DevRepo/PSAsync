"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { Timeline } from "@/components/timeline/Timeline"
import { toast } from "@/lib/toast"
import { promptDialog } from "@/lib/prompt-dialog"
import { OPPORTUNITY_TITLE_MAX, readExpectedValue } from "@/lib/opportunity-rules"
import {
  contactName,
  formatCents,
  formatDate,
  formatDateOnly,
  ownerFieldChoices,
  valueCents,
  type OpportunityRow,
  type StageOption,
  type TypeOption,
} from "@/lib/opportunity-view"
import { StagePill } from "./StagePill"
import { OpportunityRelatedPanel } from "./OpportunityRelatedPanel"
import { OpportunityAttachments } from "./OpportunityAttachments"
import { DeleteOpportunityDialog } from "./DeleteOpportunityDialog"
import { useClientContacts } from "./useClientContacts"

// GET /api/opportunities/[id] (opportunityDetailSelect)
interface OpportunityDetailData extends OpportunityRow {
  createdBy: { id: string; name: string } | null
  _count: { attachments: number; quotes: number; salesOrders: number; purchaseOrders: number }
}

const breadcrumbItems = [{ label: "Opportunities", href: "/dashboard/opportunities" }]

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"

// Laid out like HaloPSA: the client and number large on the first line, the
// title under it, the timeline in the main column, and Opportunity
// information, attachments, and Related on the right. At phone width the
// right column comes first (details, attachments, Related), then the
// timeline.
export function OpportunityDetail({ id }: { id: string }) {
  const router = useRouter()
  // For hiding controls only: every route checks the same keys itself
  const { access, can } = useAccess()
  const myUserId = access?.userId ?? null
  const canEdit = can("opportunities.edit")
  const canDelete = can("opportunities.delete")
  const canViewAll = can("opportunities.viewAll")

  const [opportunity, setOpportunity] = useState<OpportunityDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [stages, setStages] = useState<StageOption[]>([])
  const [types, setTypes] = useState<TypeOption[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [users, setUsers] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  // Bumped after every change the server records on the timeline, so the
  // timeline shows its new entry
  const [timelineKey, setTimelineKey] = useState(0)
  // A new client waits here until its contact is chosen, since an
  // opportunity always needs a contact of its own client
  const [pendingClientId, setPendingClientId] = useState<string | null>(null)
  const { contacts, loading: contactsLoading } = useClientContacts(canEdit ? pendingClientId ?? opportunity?.client.id ?? "" : "")

  const load = useCallback(() => {
    fetch(`/api/opportunities/${id}`)
      .then((res) => {
        // Someone else's opportunity, one outside the company, or any other
        // refusal all land on the same not found state
        if (!res.ok) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setOpportunity(data)
        setLoading(false)
      })
      .catch(() => {
        setNotFound(true)
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    load()
    const json = (res: Response) => (res.ok ? res.json() : [])
    fetch("/api/opportunity-stages").then(json).then((data) => Array.isArray(data) && setStages(data))
    if (!canEdit) return
    fetch("/api/opportunity-types").then(json).then((data) => Array.isArray(data) && setTypes(data))
    fetch("/api/clients").then(json).then((data) => Array.isArray(data) && setClients(data))
    if (canViewAll) fetch("/api/users").then(json).then((data) => Array.isArray(data) && setUsers(data))
  }, [load, canEdit, canViewAll])

  // Saves only the fields given. The page takes the saved opportunity back,
  // or keeps what it had and says why.
  async function save(patch: Record<string, unknown>, what: string): Promise<boolean> {
    setSaving(true)
    const res = await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      toast.error(`Couldn't save the ${what}`, data.error)
      load()
      return false
    }
    setOpportunity(data)
    setTimelineKey((k) => k + 1)
    return true
  }

  async function changeStage(stageId: string, stageName: string | undefined) {
    if (await save({ stageId }, "stage")) toast.success(`Moved to ${stageName ?? "the new stage"}`)
  }

  async function editTitle(current: string) {
    const title = await promptDialog({ title: "Rename opportunity", defaultValue: current, confirmLabel: "Save" })
    if (title === null || title === current) return
    if (title.length > OPPORTUNITY_TITLE_MAX) {
      toast.error("Couldn't save the title", `Title must be ${OPPORTUNITY_TITLE_MAX} characters or fewer`)
      return
    }
    save({ title }, "title")
  }

  async function handleDelete(): Promise<string | null> {
    const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Opportunity deleted")
      router.push("/dashboard/opportunities")
      return null
    }
    const data = await res.json().catch(() => ({}))
    // A 409 says what it is linked to, shown in the dialog as is
    return typeof data.error === "string" ? data.error : "Couldn't delete this opportunity."
  }

  if (loading) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current={null} />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }
  if (notFound || !opportunity) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current="Not found" />
        <p className="text-sm text-muted-foreground">This opportunity was not found, or you do not have access to it.</p>
      </div>
    )
  }

  const o = opportunity
  const owners = ownerFieldChoices(canViewAll, users, myUserId, o.owner)
  const clientId = pendingClientId ?? o.client.id
  // The stage list may not have loaded yet, or may not hold a stage that
  // was just deleted: the current stage is always offered
  const stageOptions = stages.some((s) => s.id === o.stage.id) ? stages : [{ ...o.stage, sortOrder: -1 }, ...stages]
  const linkedCount = o._count.quotes + o._count.salesOrders + o._count.purchaseOrders

  const stageSelect = (selectId: string, className: string) => (
    <select
      id={selectId}
      value={o.stage.id}
      disabled={saving}
      onChange={(e) => changeStage(e.target.value, stageOptions.find((s) => s.id === e.target.value)?.name)}
      className={className}
    >
      {stageOptions.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="w-full space-y-6">
      <header className="space-y-3">
        <div>
          <Breadcrumbs items={breadcrumbItems} current={o.number} />
          <Link href="/dashboard/opportunities" className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Back to Opportunities
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {/* Line 1: who the deal is with, and its number */}
            <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-display font-bold tracking-tight text-foreground">
              <Link href={`/dashboard/clients/${o.client.id}`} className="break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {o.client.name}
              </Link>
              <span className="tabular-nums text-muted-foreground">{o.number}</span>
            </h1>
            {/* Line 2: the title, smaller but clear */}
            <p className="flex items-start gap-2 text-lg font-medium text-foreground">
              <span className="break-words">{o.title}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => editTitle(o.title)}
                  disabled={saving}
                  aria-label="Rename opportunity"
                  className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
            </p>
          </div>
          {canDelete && (
            <Button variant="outline" onClick={() => setShowDelete(true)} className="text-danger hover:text-danger">
              Delete
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {canEdit && (
            <>
              <label htmlFor="opportunity-stage" className="sr-only">
                Stage
              </label>
              {stageSelect(
                "opportunity-stage",
                "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            </>
          )}
          <StagePill name={o.stage.name} category={o.stage.category} />
          <p className="text-xs text-muted-foreground">
            Created{o.createdBy ? ` by ${o.createdBy.name}` : ""} on {formatDate(o.createdAt)}
            {o.closedAt ? ` · Closed ${formatDate(o.closedAt)}` : ""}
          </p>
        </div>
      </header>

      {/* The right column comes first in the page, so at phone width the
          details lead; from lg up the grid puts the timeline on the left */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="opportunity-information-heading" className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 id="opportunity-information-heading" className="text-sm font-semibold text-foreground">
              Opportunity information
            </h2>
            {canEdit ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="opportunity-client" className={LABEL}>
                    Client
                  </label>
                  <select
                    id="opportunity-client"
                    value={clientId}
                    disabled={saving}
                    onChange={(e) => setPendingClientId(e.target.value === o.client.id ? null : e.target.value)}
                    className={FIELD}
                  >
                    {!clients.some((c) => c.id === o.client.id) && <option value={o.client.id}>{o.client.name}</option>}
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="opportunity-contact" className={LABEL}>
                    Contact
                  </label>
                  <select
                    id="opportunity-contact"
                    // Changing the client clears the contact until a new one is chosen
                    value={pendingClientId ? "" : o.contact.id}
                    disabled={saving || contactsLoading}
                    aria-describedby={pendingClientId ? "opportunity-contact-hint" : undefined}
                    onChange={async (e) => {
                      if (!e.target.value) return
                      const patch = pendingClientId ? { clientId: pendingClientId, contactId: e.target.value } : { contactId: e.target.value }
                      if (await save(patch, pendingClientId ? "client and contact" : "contact")) setPendingClientId(null)
                    }}
                    className={FIELD}
                  >
                    {pendingClientId && <option value="">{contactsLoading ? "Loading contacts..." : contacts.length === 0 ? "This client has no contacts" : "Choose a contact"}</option>}
                    {!pendingClientId && !contacts.some((c) => c.id === o.contact.id) && <option value={o.contact.id}>{contactName(o.contact)}</option>}
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </select>
                  {pendingClientId && (
                    <p id="opportunity-contact-hint" className="mt-1 text-xs text-warning">
                      Choose a contact to save the new client.{" "}
                      <button type="button" onClick={() => setPendingClientId(null)} className="font-medium underline">
                        Keep {o.client.name}
                      </button>
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="opportunity-owner" className={LABEL}>
                    Owner
                  </label>
                  <select
                    id="opportunity-owner"
                    value={o.owner?.id ?? ""}
                    disabled={saving}
                    onChange={(e) => save({ ownerId: e.target.value || null }, "owner")}
                    className={FIELD}
                  >
                    {owners.map((c) => (
                      <option key={c.value || "unassigned"} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="opportunity-details-stage" className={LABEL}>
                    Stage
                  </label>
                  {stageSelect("opportunity-details-stage", FIELD)}
                </div>
                <div>
                  <label htmlFor="opportunity-type" className={LABEL}>
                    Type
                  </label>
                  <select
                    id="opportunity-type"
                    value={o.type?.id ?? ""}
                    disabled={saving}
                    onChange={(e) => save({ typeId: e.target.value || null }, "type")}
                    className={FIELD}
                  >
                    <option value="">None</option>
                    {o.type && !types.some((t) => t.id === o.type!.id) && <option value={o.type.id}>{o.type.name}</option>}
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="opportunity-value" className={LABEL}>
                    Expected value
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input
                      key={`value-${o.expectedValue}`}
                      id="opportunity-value"
                      inputMode="decimal"
                      defaultValue={o.expectedValue ?? ""}
                      placeholder="0.00"
                      onBlur={(e) => {
                        const text = e.target.value.trim()
                        if (text === (o.expectedValue ?? "")) return
                        const value = readExpectedValue(text)
                        if (value.error !== undefined) {
                          toast.error("Couldn't save the expected value", value.error)
                          e.target.value = o.expectedValue ?? ""
                          return
                        }
                        save({ expectedValue: value.value }, "expected value")
                      }}
                      className={`${FIELD} pl-6 tabular-nums`}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="opportunity-close" className={LABEL}>
                    Expected close date
                  </label>
                  <input
                    key={`close-${o.expectedCloseDate}`}
                    id="opportunity-close"
                    type="date"
                    defaultValue={o.expectedCloseDate ? o.expectedCloseDate.slice(0, 10) : ""}
                    onBlur={(e) => {
                      const date = e.target.value
                      if (date === (o.expectedCloseDate ? o.expectedCloseDate.slice(0, 10) : "")) return
                      save({ expectedCloseDate: date || null }, "expected close date")
                    }}
                    className={FIELD}
                  />
                </div>
                <dl className="grid grid-cols-1 gap-3 border-t border-border pt-3 text-sm">
                  <ReadOnly label="Created by" value={o.createdBy?.name ?? "-"} />
                  <ReadOnly label="Created" value={formatDate(o.createdAt)} />
                </dl>
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-3 text-sm">
                <ReadOnly label="Client" value={o.client.name} />
                <ReadOnly label="Contact" value={contactName(o.contact)} />
                <ReadOnly label="Owner" value={o.owner?.name ?? "Unassigned"} />
                <ReadOnly label="Stage" value={o.stage.name} />
                <ReadOnly label="Type" value={o.type?.name ?? "-"} />
                <ReadOnly label="Expected value" value={o.expectedValue === null ? "-" : formatCents(valueCents(o.expectedValue))} />
                <ReadOnly label="Expected close date" value={formatDateOnly(o.expectedCloseDate)} />
                <ReadOnly label="Created by" value={o.createdBy?.name ?? "-"} />
                <ReadOnly label="Created" value={formatDate(o.createdAt)} />
              </dl>
            )}
          </section>

          <OpportunityAttachments opportunityId={o.id} canEdit={canEdit} onChanged={() => setTimelineKey((k) => k + 1)} />
          <OpportunityRelatedPanel opportunityId={o.id} linkedCount={linkedCount} />
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Timeline timelineUrl={`/api/opportunities/${o.id}/timeline`} canAddNotes={canEdit} myUserId={myUserId} refreshKey={timelineKey} />
        </div>
      </div>

      {showDelete && (
        <DeleteOpportunityDialog opportunity={o} onCancel={() => setShowDelete(false)} onDelete={handleDelete} />
      )}
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate text-foreground" title={value}>
        {value}
      </dd>
    </div>
  )
}
