"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { ClientContactPicker } from "@/components/ClientContactPicker"
import { InlineEditField, InlineFieldLink, InlineInput, InlineListbox } from "@/components/inline-edit/InlineEditField"
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
  teamChoices,
  valueCents,
  type ClientLocationSummary,
  type OpportunityRow,
  type StageCategory,
  type StageOption,
  type TypeOption,
} from "@/lib/opportunity-view"
import { StagePill } from "./StagePill"
import { useClientLocations } from "./useClientLocations"
import { clientContactHref, clientLocationHref, clientPageHref } from "@/lib/client-links"
import type { TeamSummary } from "@/lib/team-rules"

// GET /api/opportunities/[id] (opportunityDetailSelect), with the client
// details only users who may open the opportunity get
export interface OpportunityDetailData extends OpportunityRow {
  clientLocation: ClientLocationSummary | null
  client: { id: string; name: string; phone: string | null; locations: ClientLocationSummary[]; mainBillingLocation: ClientLocationSummary | null }
  contact: { id: string; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null }
  createdBy: { id: string; name: string } | null
  _count: { attachments: number; quotes: number; salesOrders: number; purchaseOrders: number }
}

type FieldKey = "party" | "location" | "team" | "owner" | "stage" | "type" | "value" | "date"

const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"
const LINK = "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const DASH = <span className="text-muted-foreground">-</span>
const STAGE_GROUPS: StageCategory[] = ["OPEN", "WON", "LOST"]

// Where each name opens, in a new tab (src/lib/client-links.ts): the client
// page on its default tab, or its Contacts or Locations tab with that row
// highlighted. There is no contact or location page of its own.

function LocationText({ location, clientId, note }: { location: ClientLocationSummary; clientId: string; note?: string }) {
  const lines = addressLines(location)
  return (
    <>
      <span className="block font-medium">
        <InlineFieldLink href={clientLocationHref(clientId, location.id)} title={`Open ${location.name} on the client page`}>
          {location.name}
        </InlineFieldLink>
      </span>
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

// The opportunity page's right column panel, in the HaloPSA style: a Client
// group, then an Opportunity group, label above value. With
// opportunities.edit every opportunity field edits in place on one click
// (InlineEditField); everything else is read only. One field edits at a
// time. The client, contact, and location names open their page in a new
// tab, with or without edit. save is the page's PATCH, which toasts its own
// errors.
export function OpportunityInfoPanel({
  o,
  canEdit,
  stages,
  types,
  clients,
  users,
  teams,
  canViewAll,
  save,
}: {
  o: OpportunityDetailData
  canEdit: boolean
  stages: StageOption[]
  types: TypeOption[]
  clients: { id: string; name: string }[]
  users: { id: string; name: string; active: boolean }[]
  // GET /api/teams: the teams it may move to, and who may own it in each
  teams: TeamSummary[]
  canViewAll: boolean
  save: (patch: Record<string, unknown>, what: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<FieldKey | null>(null)
  // Which search the client and contact editor opens in
  const [partyFocus, setPartyFocus] = useState<"client" | "contact">("client")
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

  function openParty(focus: "client" | "contact") {
    setPartyDraft(null)
    setPartyFocus(focus)
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
    else {
      setPartyDraft(next)
      // A new client without a contact: the contact search comes next
      setPartyFocus("contact")
    }
  }

  // Owners are Unassigned and the members of its team the user may assign
  const team = o.team ? (teams.find((t) => t.id === o.team!.id) ?? null) : null
  const owners = ownerFieldChoices(team?.assignableOwnerIds ?? [], users, o.owner)
  // Teams it may move to: the user's own teams (all with viewAll), plus its current one
  const teamOptions = teamChoices(teams, canViewAll, { keepId: o.team?.id }).map((t) => ({ value: t.id, label: t.name }))
  if (o.team && !teamOptions.some((t) => t.value === o.team!.id)) teamOptions.unshift({ value: o.team.id, label: o.team.name })

  // A new team whose members the user may assign don't include the owner
  // clears the owner in the same save (the server refuses to keep an owner
  // outside the team)
  async function saveTeam(teamId: string) {
    if (teamId === o.team?.id) return true
    const next = teams.find((t) => t.id === teamId)
    const keepOwner = !o.owner || !!next?.assignableOwnerIds.includes(o.owner.id)
    const saved = await save(keepOwner ? { teamId } : { teamId, ownerId: null }, "team")
    if (saved && !keepOwner) toast.success("Team changed", "The owner is not in the new team, so the opportunity is now unassigned.")
    return saved
  }
  const stageList = stages.some((s) => s.id === o.stage.id) ? stages : [{ ...o.stage, sortOrder: -1 }, ...stages]
  const stageOptions = STAGE_GROUPS.flatMap((category) =>
    stageList.filter((s) => s.category === category).map((s) => ({ value: s.id, label: s.name, group: CATEGORY_LABELS[category] }))
  )
  const typeOptions = [{ value: "", label: "None" }, ...(o.type && !types.some((t) => t.id === o.type!.id) ? [{ value: o.type.id, label: o.type.name }] : []), ...types.map((t) => ({ value: t.id, label: t.name }))]
  const clientMain = mainClientLocation(o.client)
  const locationOptions = [
    { value: "", label: "No location" },
    ...(o.clientLocation && !locations.some((l) => l.id === o.clientLocation!.id) ? [{ value: o.clientLocation.id, label: o.clientLocation.name }] : []),
    ...locations.map((l) => ({ value: l.id, label: l.id === mainId ? `${l.name} (main)` : l.name })),
  ]

  return (
    <section aria-labelledby="opportunity-panel-heading" className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 id="opportunity-panel-heading" className="sr-only">
        Opportunity details
      </h2>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>
        {canEdit && editing === "party" ? (
          <div
            className="-mx-2 space-y-3 rounded-md border border-ring px-2 py-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeParty()
            }}
          >
            {/* Keyed by the focused search, so it focuses again when a new
                client moves the focus on to Contact */}
            <ClientContactPicker
              key={partyFocus}
              value={partyDraft ?? savedParty}
              onChange={changeParty}
              clients={clients}
              labelClassName={LABEL}
              autoFocus={partyFocus}
            />
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
              renderValue={(name) => <InlineFieldLink href={clientPageHref(o.client.id)}>{name}</InlineFieldLink>}
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty("client")}
              onSave={async () => true}
              renderEditor={() => null}
              busy={partySaving}
            />
            <InlineEditField
              label="Contact"
              value={contactFullName(o.contact)}
              renderValue={(name) => (
                <InlineFieldLink href={clientContactHref(o.client.id, o.contact.id)} title={`Open ${name} on the client page`}>
                  {name}
                </InlineFieldLink>
              )}
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty("contact")}
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
            if (chosen) return <LocationText location={chosen} clientId={o.client.id} />
            // None chosen: the client's main location, said as such
            return clientMain ? <LocationText location={clientMain} clientId={o.client.id} note="The client's main location (none chosen)" /> : DASH
          }}
          onSave={(id) => save({ clientLocationId: id || null }, "location")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Location" value={value} options={locationOptions} commit={commit} cancel={cancel} />}
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

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opportunity</h3>
        <InlineEditField
          label="Team"
          value={o.team?.id ?? ""}
          renderValue={(id) => teamOptions.find((t) => t.value === id)?.label ?? o.team?.name ?? DASH}
          onSave={saveTeam}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Team" value={value} options={teamOptions} commit={commit} cancel={cancel} />}
          {...field("team")}
        />
        <InlineEditField
          label="Owner"
          value={o.owner?.id ?? ""}
          renderValue={(id) => owners.find((c) => c.value === id)?.label ?? (id ? o.owner?.name : "Unassigned")}
          onSave={(id) => save({ ownerId: id || null }, "owner")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Owner" value={value} options={owners} commit={commit} cancel={cancel} />}
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
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Stage" value={value} options={stageOptions} commit={commit} cancel={cancel} />}
          {...field("stage")}
        />
        <InlineEditField
          label="Type"
          value={o.type?.id ?? ""}
          renderValue={(id) => typeOptions.find((t) => t.value === id)?.label ?? "None"}
          onSave={(id) => save({ typeId: id || null }, "type")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Type" value={value} options={typeOptions} commit={commit} cancel={cancel} />}
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
    </section>
  )
}
