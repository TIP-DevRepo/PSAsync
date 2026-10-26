"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClientContactPicker } from "@/components/ClientContactPicker"
import { InlineEditField, InlineInput, InlineSelect } from "@/components/inline-edit/InlineEditField"
import { toast } from "@/lib/toast"
import { CATEGORY_LABELS, readExpectedValue } from "@/lib/opportunity-rules"
import { mainClientLocation } from "@/lib/client-main-location"
import { contactFullName, type ClientContactValue } from "@/lib/client-contact-choice"
import {
  addressLines,
  formatCents,
  formatDate,
  formatDateOnly,
  ownerFieldChoices,
  valueCents,
  type ClientLocationSummary,
  type OpportunityRow,
  type StageCategory,
  type StageOption,
  type TypeOption,
} from "@/lib/opportunity-view"
import { StagePill } from "./StagePill"
import { useClientLocations } from "./useClientLocations"

// GET /api/opportunities/[id] (opportunityDetailSelect), with the client
// details only users who may open the opportunity get
export interface OpportunityDetailData extends OpportunityRow {
  clientLocation: ClientLocationSummary | null
  client: { id: string; name: string; phone: string | null; locations: ClientLocationSummary[]; mainBillingLocation: ClientLocationSummary | null }
  contact: { id: string; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null }
  createdBy: { id: string; name: string } | null
  _count: { attachments: number; quotes: number; salesOrders: number; purchaseOrders: number }
}

type FieldKey = "party" | "location" | "owner" | "stage" | "type" | "value" | "date"

const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"
const LINK = "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const DASH = <span className="text-muted-foreground">-</span>
const STAGE_GROUPS: StageCategory[] = ["OPEN", "WON", "LOST"]

function LocationText({ location, note }: { location: ClientLocationSummary; note?: string }) {
  const lines = addressLines(location)
  return (
    <>
      <span className="block font-medium">{location.name}</span>
      {lines.map((line, i) => (
        <span key={i} className="block text-muted-foreground">
          {line}
        </span>
      ))}
      {note && <span className="block text-xs text-muted-foreground">{note}</span>}
    </>
  )
}

// A value that never edits in place: plain, no outline
function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="break-words text-sm text-foreground">{children}</div>
    </div>
  )
}

const phoneLink = (phone: string | null) => (phone ? <a href={`tel:${phone}`} className={LINK}>{phone}</a> : DASH)

// The opportunity page's right column panel, in the HaloPSA style: an
// Opportunity group and a Client group, label above value. With
// opportunities.edit every opportunity field edits in place
// (InlineEditField); everything else is read only. One field edits at a
// time. save is the page's PATCH, which toasts its own errors.
export function OpportunityInfoPanel({
  o,
  canEdit,
  stages,
  types,
  clients,
  users,
  myUserId,
  canViewAll,
  save,
}: {
  o: OpportunityDetailData
  canEdit: boolean
  stages: StageOption[]
  types: TypeOption[]
  clients: { id: string; name: string }[]
  users: { id: string; name: string; active: boolean }[]
  myUserId: string | null
  canViewAll: boolean
  save: (patch: Record<string, unknown>, what: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<FieldKey | null>(null)
  // A client picked without a contact waits here until one of its contacts
  // is chosen; the location then resets to that client's main location
  const [partyDraft, setPartyDraft] = useState<ClientContactValue | null>(null)
  const [partySaving, setPartySaving] = useState(false)
  const { locations, mainId } = useClientLocations(canEdit ? o.client.id : null)

  const field = (key: FieldKey) => ({
    canEdit,
    editing: editing === key,
    onEditingChange: (open: boolean) => setEditing(open ? key : null),
  })

  const savedParty: ClientContactValue = {
    client: { id: o.client.id, name: o.client.name },
    contact: { id: o.contact.id, name: contactFullName(o.contact), clientId: o.client.id },
  }

  function openParty() {
    setPartyDraft(null)
    setEditing("party")
  }
  function closeParty() {
    setPartyDraft(null)
    setEditing(null)
  }
  async function changeParty(next: ClientContactValue) {
    const changed = next.contact?.id !== o.contact.id || next.client?.id !== o.client.id
    if (next.client && next.contact && changed) {
      closeParty()
      setPartySaving(true)
      await save({ clientId: next.client.id, contactId: next.contact.id }, next.client.id !== o.client.id ? "client and contact" : "contact")
      setPartySaving(false)
      return
    }
    if (!changed) closeParty()
    else setPartyDraft(next)
  }

  const owners = ownerFieldChoices(canViewAll, users, myUserId, o.owner)
  const stageList = stages.some((s) => s.id === o.stage.id) ? stages : [{ ...o.stage, sortOrder: -1 }, ...stages]
  const typeOptions = [{ value: "", label: "None" }, ...(o.type && !types.some((t) => t.id === o.type!.id) ? [{ value: o.type.id, label: o.type.name }] : []), ...types.map((t) => ({ value: t.id, label: t.name }))]
  const clientMain = mainClientLocation(o.client)
  const locationOptions = [
    { value: "", label: "No location" },
    ...(o.clientLocation && !locations.some((l) => l.id === o.clientLocation!.id) ? [{ value: o.clientLocation.id, label: o.clientLocation.name }] : []),
    ...locations.map((l) => ({ value: l.id, label: l.id === mainId ? `${l.name} (main)` : l.name })),
  ]

  const clientLink = (
    <Link href={`/dashboard/clients/${o.client.id}`} className={`${LINK} inline-flex items-center gap-1 text-xs`} aria-label={`Open ${o.client.name}`}>
      Open <ExternalLink size={11} aria-hidden="true" />
    </Link>
  )

  return (
    <section aria-labelledby="opportunity-panel-heading" className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 id="opportunity-panel-heading" className="sr-only">
        Opportunity details
      </h2>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opportunity</h3>
        <InlineEditField
          label="Owner"
          value={o.owner?.id ?? ""}
          renderValue={(id) => owners.find((c) => c.value === id)?.label ?? (id ? o.owner?.name : "Unassigned")}
          onSave={(id) => save({ ownerId: id || null }, "owner")}
          renderEditor={({ value, commit, cancel }) => <InlineSelect ariaLabel="Owner" value={value} options={owners} commit={commit} cancel={cancel} />}
          {...field("owner")}
        />
        <InlineEditField
          label="Stage"
          value={o.stage.id}
          renderValue={(id) => {
            const stage = stageList.find((s) => s.id === id) ?? o.stage
            return <StagePill name={stage.name} category={stage.category} />
          }}
          onSave={(id) => save({ stageId: id }, "stage")}
          renderEditor={({ value, commit, cancel }) => (
            <InlineSelect
              ariaLabel="Stage"
              value={value}
              groups={STAGE_GROUPS.map((category) => ({
                label: CATEGORY_LABELS[category],
                options: stageList.filter((s) => s.category === category).map((s) => ({ value: s.id, label: s.name })),
              }))}
              commit={commit}
              cancel={cancel}
            />
          )}
          {...field("stage")}
        />
        <InlineEditField
          label="Type"
          value={o.type?.id ?? ""}
          renderValue={(id) => typeOptions.find((t) => t.value === id)?.label ?? "None"}
          onSave={(id) => save({ typeId: id || null }, "type")}
          renderEditor={({ value, commit, cancel }) => <InlineSelect ariaLabel="Type" value={value} options={typeOptions} commit={commit} cancel={cancel} />}
          {...field("type")}
        />
        <InlineEditField
          label="Expected value"
          value={o.expectedValue ?? ""}
          renderValue={(v) => (v ? <span className="tabular-nums">{formatCents(valueCents(v))}</span> : DASH)}
          onSave={async (text) => {
            const value = readExpectedValue(text)
            if (value.error !== undefined) {
              toast.error("Couldn't save the expected value", value.error)
              return false
            }
            return save({ expectedValue: value.value }, "expected value")
          }}
          renderEditor={({ value, commit, cancel }) => (
            <InlineInput ariaLabel="Expected value" value={value} inputMode="decimal" placeholder="0.00" prefix="$" commit={commit} cancel={cancel} />
          )}
          {...field("value")}
        />
        <InlineEditField
          label="Expected close date"
          value={o.expectedCloseDate ? o.expectedCloseDate.slice(0, 10) : ""}
          renderValue={(v) => (v ? formatDateOnly(`${v}T00:00:00.000Z`) : DASH)}
          onSave={(v) => save({ expectedCloseDate: v || null }, "expected close date")}
          renderEditor={({ value, commit, cancel }) => <InlineInput ariaLabel="Expected close date" type="date" value={value} commit={commit} cancel={cancel} />}
          {...field("date")}
        />
        <ReadOnly label="Created by">{o.createdBy?.name ?? DASH}</ReadOnly>
        <ReadOnly label="Created">{formatDate(o.createdAt)}</ReadOnly>
        <ReadOnly label="Closed">{o.closedAt ? formatDate(o.closedAt) : DASH}</ReadOnly>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>
        {canEdit && editing === "party" ? (
          <div
            className="-mx-2 space-y-3 rounded-md border border-ring px-2 py-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeParty()
            }}
          >
            <ClientContactPicker value={partyDraft ?? savedParty} onChange={changeParty} clients={clients} labelClassName={LABEL} />
            {partyDraft && !partyDraft.contact && (
              <p className="text-xs text-warning">
                {partyDraft.client ? "Choose a contact to save the new client. The location then resets to its main location." : "Choose a client and contact."}
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={closeParty}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <InlineEditField
              label="Client"
              value={o.client.name}
              renderValue={(name) => (canEdit ? name : <Link href={`/dashboard/clients/${o.client.id}`} className={LINK}>{name}</Link>)}
              aside={canEdit ? clientLink : undefined}
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty()}
              onSave={async () => true}
              renderEditor={() => null}
              busy={partySaving}
            />
            <InlineEditField
              label="Contact"
              value={contactFullName(o.contact)}
              renderValue={(name) => name}
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty()}
              onSave={async () => true}
              renderEditor={() => null}
              busy={partySaving}
            />
          </>
        )}
        <InlineEditField
          label="Location"
          value={o.clientLocation?.id ?? ""}
          renderValue={(id) => {
            const chosen = id === o.clientLocation?.id ? o.clientLocation : (locations.find((l) => l.id === id) ?? null)
            if (chosen) return <LocationText location={chosen} />
            // None chosen: the client's main location, said as such
            return clientMain ? <LocationText location={clientMain} note="The client's main location (none chosen)" /> : DASH
          }}
          onSave={(id) => save({ clientLocationId: id || null }, "location")}
          renderEditor={({ value, commit, cancel }) => <InlineSelect ariaLabel="Location" value={value} options={locationOptions} commit={commit} cancel={cancel} />}
          busy={partySaving}
          {...field("location")}
        />
        <ReadOnly label="Main phone">{phoneLink(o.client.phone)}</ReadOnly>
        <ReadOnly label="Contact title">{o.contact.title || DASH}</ReadOnly>
        <ReadOnly label="Contact email">
          {o.contact.email ? (
            <a href={`mailto:${o.contact.email}`} className={LINK} title={o.contact.email}>
              {o.contact.email}
            </a>
          ) : (
            DASH
          )}
        </ReadOnly>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <ReadOnly label="Work phone">{phoneLink(o.contact.phone)}</ReadOnly>
          <ReadOnly label="Mobile">{phoneLink(o.contact.mobile)}</ReadOnly>
        </div>
      </div>
    </section>
  )
}
