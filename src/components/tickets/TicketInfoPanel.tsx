"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { InfoPanelCard } from "@/components/ui/blocks"
import { ClientContactPicker } from "@/components/ClientContactPicker"
import { InlineEditField, InlineFieldLink, InlineListbox } from "@/components/inline-edit/InlineEditField"
import { useClientLocations } from "@/components/opportunities/useClientLocations"
import { contactFullName, type ClientContactValue } from "@/lib/client-contact-choice"
import { addressLines, type ClientLocationSummary } from "@/lib/opportunity-view"
import { clientContactHref, clientLocationHref, clientPageHref } from "@/lib/client-links"
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_CATEGORIES } from "@/lib/ticket-rules"
import { assigneeFieldChoices, ticketTeamChoices, type TicketOption, type TicketRow, type TicketStatusOption } from "@/lib/ticket-view"
import type { TeamSummary } from "@/lib/team-rules"
import { TicketPriorityMarker, TicketStatusPill } from "./TicketPills"

// GET /api/tickets/[id] (ticketDetailSelect): the list's fields plus the
// client details only users who may open the ticket get
export interface TicketDetailData extends Omit<TicketRow, "client" | "contact"> {
  client: { id: string; name: string; phone: string | null } | null
  contact: { id: string; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null } | null
  clientLocation: ClientLocationSummary | null
  createdBy: { id: string; name: string } | null
  _count: { attachments: number }
}

type FieldKey = "party" | "location" | "team" | "assignee" | "status" | "priority" | "type"

const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"
const LINK = "text-acc-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const DASH = <span className="text-muted-foreground">-</span>

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5 py-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="break-words text-sm font-medium text-foreground">{children}</div>
    </div>
  )
}

const phoneLink = (phone: string | null | undefined) => (phone ? <a href={`tel:${phone}`} className={LINK}>{phone}</a> : DASH)

function LocationText({ location, clientId, note }: { location: ClientLocationSummary; clientId: string; note?: string }) {
  return (
    <>
      <span className="block font-medium">
        <InlineFieldLink href={clientLocationHref(clientId, location.id)} title={`Open ${location.name} on the client page`}>
          {location.name}
        </InlineFieldLink>
      </span>
      {addressLines(location).map((line, i) => (
        <span key={i} className="block text-muted-foreground">
          {line}
        </span>
      ))}
      {note && <span className="block text-xs text-muted-foreground">{note}</span>}
    </>
  )
}

// The ticket page's right column, the same pattern as the opportunity's
// (InfoPanelCard, label above value, one field editing at a time): a Client
// card (client, contact, location, then the contact's email and phones,
// read only) and a Ticket card (queue, assignee, status, priority, type).
// With tickets.edit every field edits in place (InlineEditField). A ticket
// may have no client: the Client field then opens the shared client and
// contact picker, and a chosen client can be removed again. Choosing a
// client without a contact saves it alone (the contact clears and the
// location resets to its main location, the server's rule); picking a
// contact saves the pair. The client, contact, and location names open the
// client page in a new tab. save is the page's PATCH; saveTeam handles a
// queue whose members don't include the assignee.
export function TicketInfoPanel({
  t,
  canEdit,
  teams,
  users,
  types,
  priorities,
  statuses,
  clients,
  canAssign,
  canViewAll,
  save,
  saveTeam,
}: {
  t: TicketDetailData
  canEdit: boolean
  teams: TeamSummary[]
  users: { id: string; name: string; active: boolean }[]
  types: TicketOption[]
  priorities: TicketOption[]
  statuses: TicketStatusOption[]
  clients: { id: string; name: string }[]
  canAssign: boolean
  canViewAll: boolean
  save: (patch: Record<string, unknown>, what: string) => Promise<boolean>
  saveTeam: (teamId: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<FieldKey | null>(null)
  const [partyFocus, setPartyFocus] = useState<"client" | "contact">("client")
  const [partySaving, setPartySaving] = useState(false)
  const { locations, mainId } = useClientLocations(t.client?.id ?? null)

  const field = (key: FieldKey) => ({
    canEdit,
    editing: editing === key,
    onEditingChange: (open: boolean) => setEditing(open ? key : null),
  })

  const savedParty: ClientContactValue = {
    client: t.client ? { id: t.client.id, name: t.client.name } : null,
    contact: t.contact && t.client ? { id: t.contact.id, name: contactFullName(t.contact), clientId: t.client.id } : null,
  }

  function openParty(focus: "client" | "contact") {
    setPartyFocus(focus)
    setEditing("party")
  }

  async function saveParty(patch: Record<string, unknown>, what: string) {
    setEditing(null)
    setPartySaving(true)
    await save(patch, what)
    setPartySaving(false)
  }

  async function changeParty(next: ClientContactValue) {
    if (next.contact && next.contact.id !== t.contact?.id) {
      await saveParty({ clientId: next.client?.id ?? null, contactId: next.contact.id }, next.client?.id !== t.client?.id ? "client and contact" : "contact")
      return
    }
    if (next.client?.id !== t.client?.id) {
      // A client on its own: the server clears the contact and resets the
      // location to the new client's main location
      await saveParty({ clientId: next.client?.id ?? null }, "client")
      return
    }
    setEditing(null)
  }

  // The queues it may move to, plus its current one
  const teamOptions = ticketTeamChoices(teams, { canAssign, canViewAll, keepId: t.team.id }).map((team) => ({ value: team.id, label: team.name }))
  if (!teamOptions.some((o) => o.value === t.team.id)) teamOptions.unshift({ value: t.team.id, label: t.team.name })
  const team = teams.find((x) => x.id === t.team.id) ?? null
  const assignees = assigneeFieldChoices(team?.assignableAssigneeIds ?? [], users, t.assignee)

  const statusList = statuses.some((s) => s.id === t.status.id) ? statuses : [{ ...t.status, sortOrder: -1 }, ...statuses]
  const statusOptions = TICKET_STATUS_CATEGORIES.flatMap((category) =>
    statusList.filter((s) => s.category === category).map((s) => ({ value: s.id, label: s.name, group: TICKET_CATEGORY_LABELS[category] }))
  )
  const priorityList = priorities.some((p) => p.id === t.priority.id) ? priorities : [t.priority, ...priorities]
  const priorityOptions = priorityList.map((p) => ({ value: p.id, label: p.name }))
  const typeList = types.some((x) => x.id === t.type.id) ? types : [{ ...t.type, sortOrder: -1 }, ...types]
  const typeOptions = typeList.map((x) => ({ value: x.id, label: x.name }))
  const priorityOrders = priorityList.map((p) => p.sortOrder)

  const mainLocation = locations.find((l) => l.id === mainId) ?? null
  const locationOptions = [
    { value: "", label: "No location" },
    ...(t.clientLocation && !locations.some((l) => l.id === t.clientLocation!.id) ? [{ value: t.clientLocation.id, label: t.clientLocation.name }] : []),
    ...locations.map((l) => ({ value: l.id, label: l.id === mainId ? `${l.name} (main)` : l.name })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <InfoPanelCard title="Client" id="ticket-panel-client">
        {canEdit && editing === "party" ? (
          <div
            className="-mx-2 space-y-3 rounded-md border border-ring px-2 py-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null)
            }}
          >
            <ClientContactPicker key={partyFocus} value={savedParty} onChange={changeParty} clients={clients} labelClassName={LABEL} autoFocus={partyFocus} />
            <div className="flex flex-wrap justify-end gap-2">
              {t.contact && (
                <Button size="sm" variant="outline" onClick={() => saveParty({ contactId: null }, "contact")}>
                  Remove contact
                </Button>
              )}
              {t.client && (
                <Button size="sm" variant="outline" onClick={() => saveParty({ clientId: null }, "client")}>
                  Remove client
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <InlineEditField
              label="Client"
              value={t.client?.name ?? ""}
              renderValue={(name) => (t.client ? <InlineFieldLink href={clientPageHref(t.client.id)}>{name}</InlineFieldLink> : <span className="text-muted-foreground">No client</span>)}
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty("client")}
              onSave={async () => true}
              renderEditor={() => null}
              busy={partySaving}
            />
            <InlineEditField
              label="Contact"
              value={t.contact ? contactFullName(t.contact) : ""}
              renderValue={(name) =>
                t.contact && t.client ? (
                  <InlineFieldLink href={clientContactHref(t.client.id, t.contact.id)} title={`Open ${name} on the client page`}>
                    {name}
                  </InlineFieldLink>
                ) : (
                  DASH
                )
              }
              canEdit={canEdit}
              editing={false}
              onEditingChange={(open) => open && openParty("contact")}
              onSave={async () => true}
              renderEditor={() => null}
              busy={partySaving}
            />
          </>
        )}
        {t.client ? (
          <InlineEditField
            label="Location"
            value={t.clientLocation?.id ?? ""}
            renderValue={(id) => {
              const chosen = id === t.clientLocation?.id ? t.clientLocation : (locations.find((l) => l.id === id) ?? null)
              if (chosen) return <LocationText location={chosen} clientId={t.client!.id} />
              return mainLocation ? <LocationText location={mainLocation} clientId={t.client!.id} note="The client's main location (none chosen)" /> : DASH
            }}
            onSave={(id) => save({ clientLocationId: id || null }, "location")}
            renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Location" value={value} options={locationOptions} commit={commit} cancel={cancel} />}
            busy={partySaving}
            {...field("location")}
          />
        ) : (
          <ReadOnly label="Location">{DASH}</ReadOnly>
        )}
        <ReadOnly label="Main phone">{phoneLink(t.client?.phone)}</ReadOnly>
        <ReadOnly label="Contact email">
          {t.contact?.email ? (
            <a href={`mailto:${t.contact.email}`} className={LINK} title={t.contact.email}>
              {t.contact.email}
            </a>
          ) : (
            DASH
          )}
        </ReadOnly>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <ReadOnly label="Work phone">{phoneLink(t.contact?.phone)}</ReadOnly>
          <ReadOnly label="Mobile">{phoneLink(t.contact?.mobile)}</ReadOnly>
        </div>
      </InfoPanelCard>

      <InfoPanelCard title="Ticket" id="ticket-panel-ticket">
        <InlineEditField
          label="Queue"
          value={t.team.id}
          renderValue={(id) => teamOptions.find((o) => o.value === id)?.label ?? t.team.name}
          onSave={saveTeam}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Queue" value={value} options={teamOptions} commit={commit} cancel={cancel} />}
          {...field("team")}
        />
        <InlineEditField
          label="Assignee"
          value={t.assignee?.id ?? ""}
          renderValue={(id) => assignees.find((a) => a.value === id)?.label ?? (id ? t.assignee?.name : "Unassigned")}
          onSave={(id) => save({ assigneeId: id || null }, "assignee")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Assignee" value={value} options={assignees} commit={commit} cancel={cancel} />}
          {...field("assignee")}
        />
        <InlineEditField
          label="Status"
          value={t.status.id}
          renderValue={(id) => {
            const status = statusList.find((s) => s.id === id) ?? t.status
            return <TicketStatusPill name={status.name} category={status.category} />
          }}
          onSave={(id) => save({ statusId: id }, "status")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Status" value={value} options={statusOptions} commit={commit} cancel={cancel} />}
          {...field("status")}
        />
        <InlineEditField
          label="Priority"
          value={t.priority.id}
          renderValue={(id) => {
            const p = priorityList.find((x) => x.id === id) ?? t.priority
            return <TicketPriorityMarker name={p.name} sortOrder={p.sortOrder} allOrders={priorityOrders} />
          }}
          onSave={(id) => save({ priorityId: id }, "priority")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Priority" value={value} options={priorityOptions} commit={commit} cancel={cancel} />}
          {...field("priority")}
        />
        <InlineEditField
          label="Type"
          value={t.type.id}
          renderValue={(id) => typeOptions.find((o) => o.value === id)?.label ?? t.type.name}
          onSave={(id) => save({ typeId: id }, "type")}
          renderEditor={({ value, commit, cancel }) => <InlineListbox ariaLabel="Type" value={value} options={typeOptions} commit={commit} cancel={cancel} />}
          {...field("type")}
        />
      </InfoPanelCard>
    </div>
  )
}
