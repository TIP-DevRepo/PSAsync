"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { OPPORTUNITY_NOTES_MAX, OPPORTUNITY_TITLE_MAX, readExpectedValue } from "@/lib/opportunity-rules"
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
  notes: string | null
  createdBy: { id: string; name: string } | null
  _count: { attachments: number; quotes: number; salesOrders: number; purchaseOrders: number }
}

const breadcrumbItems = [{ label: "Opportunities", href: "/dashboard/opportunities" }]

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"

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
    return true
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

  return (
    <div className="w-full space-y-6">
      <div>
        <Breadcrumbs items={breadcrumbItems} current={o.number} />
        <Link href="/dashboard/opportunities" className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Back to Opportunities
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium tabular-nums text-muted-foreground">{o.number}</p>
            <h1 className="break-words text-display font-semibold tracking-tight text-foreground">{o.title}</h1>
            <p className="text-sm text-muted-foreground">
              Owner: <span className="text-foreground">{o.owner?.name ?? "Unassigned"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Created{o.createdBy ? ` by ${o.createdBy.name}` : ""} on {formatDate(o.createdAt)}
              {o.closedAt ? ` · Closed ${formatDate(o.closedAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <label htmlFor="opportunity-stage" className="sr-only">
                  Stage
                </label>
                <select
                  id="opportunity-stage"
                  value={o.stage.id}
                  disabled={saving}
                  onChange={async (e) => {
                    const stage = stageOptions.find((s) => s.id === e.target.value)
                    if (await save({ stageId: e.target.value }, "stage")) toast.success(`Moved to ${stage?.name ?? "the new stage"}`)
                  }}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {stageOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <StagePill name={o.stage.name} category={o.stage.category} />
            {canDelete && (
              <Button variant="outline" onClick={() => setShowDelete(true)} className="text-danger hover:text-danger">
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="opportunity-details-heading" className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 id="opportunity-details-heading" className="text-sm font-semibold text-foreground">
              Details
            </h2>
            {canEdit ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="opportunity-title" className={LABEL}>
                    Title
                  </label>
                  <input
                    key={`title-${o.title}`}
                    id="opportunity-title"
                    defaultValue={o.title}
                    maxLength={OPPORTUNITY_TITLE_MAX}
                    onBlur={(e) => {
                      const title = e.target.value.trim()
                      if (title === o.title) return
                      if (!title) {
                        toast.error("Title is required")
                        e.target.value = o.title
                        return
                      }
                      save({ title }, "title")
                    }}
                    className={FIELD}
                  />
                </div>

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
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <ReadOnly label="Client" value={o.client.name} />
                <ReadOnly label="Contact" value={contactName(o.contact)} />
                <ReadOnly label="Owner" value={o.owner?.name ?? "Unassigned"} />
                <ReadOnly label="Type" value={o.type?.name ?? "-"} />
                <ReadOnly label="Expected value" value={o.expectedValue === null ? "-" : formatCents(valueCents(o.expectedValue))} />
                <ReadOnly label="Expected close date" value={formatDateOnly(o.expectedCloseDate)} />
              </dl>
            )}
          </section>

          <section aria-labelledby="opportunity-notes-heading" className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 id="opportunity-notes-heading" className="text-sm font-semibold text-foreground">
              Notes
            </h2>
            {canEdit ? (
              <textarea
                key={`notes-${o.notes}`}
                aria-labelledby="opportunity-notes-heading"
                defaultValue={o.notes ?? ""}
                maxLength={OPPORTUNITY_NOTES_MAX}
                rows={5}
                placeholder="Anything the team should know about this deal"
                onBlur={(e) => {
                  const notes = e.target.value.trim()
                  if (notes === (o.notes ?? "")) return
                  save({ notes: notes || null }, "notes")
                }}
                className={FIELD}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-foreground">{o.notes || <span className="text-muted-foreground">No notes yet.</span>}</p>
            )}
          </section>

          <OpportunityAttachments opportunityId={o.id} canEdit={canEdit} />
        </div>

        <div className="min-w-0">
          <OpportunityRelatedPanel opportunityId={o.id} linkedCount={linkedCount} />
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
