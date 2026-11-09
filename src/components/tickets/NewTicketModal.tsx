"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { ClientContactPicker } from "@/components/ClientContactPicker"
import { useClientLocations } from "@/components/opportunities/useClientLocations"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { isBlankHtml } from "@/lib/timeline-actions"
import { TICKET_TITLE_MAX } from "@/lib/ticket-rules"
import { assigneeFieldChoices, defaultNewTicketTeamId, firstByOrder, ROUND_ROBIN_NOTE, ticketTeamChoices } from "@/lib/ticket-view"
import type { ClientContactValue } from "@/lib/client-contact-choice"
import type { TicketOptions } from "./useTicketOptions"

// The design's form fields, as the New opportunity dialog draws them
const FIELD =
  "min-h-9 w-full rounded-control border border-border bg-surface-2 px-2.5 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-[13px] font-medium text-muted-foreground"

// The New ticket dialog (tickets.create): a title, then client, contact, and
// location, all optional (the shared ClientContactPicker: picking a contact
// sets its client; the location starts on the client's main location and
// is left out of the request until changed, so the server saves the main
// location), the queue (the default ticket queue, which every creator may
// use, else the user's first team), the assignee (Unassigned first, then
// the queue's members the user may assign; a note says when the queue's
// round robin will assign it), type and priority (each the first in Ticket
// Settings' order), and the required initial note, the first timeline
// entry. client starts it on a client (the client page's Tickets tab).
export function NewTicketModal({
  options,
  client,
  onClose,
  onCreated,
}: {
  options: TicketOptions
  client?: { id: string; name: string } | null
  onClose: () => void
  onCreated: (ticket: { id: string; number: string }) => void
}) {
  const { can } = useAccess()
  const canAssign = can("tickets.assign")
  const canViewAll = can("tickets.viewAll")
  const { teams, users, types, priorities, clients, defaultTeamId } = options

  const [title, setTitle] = useState("")
  const [teamPick, setTeamPick] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [typePick, setTypePick] = useState("")
  const [priorityPick, setPriorityPick] = useState("")
  const [initialNote, setInitialNote] = useState("")
  const [party, setParty] = useState<ClientContactValue>({ client: client ?? null, contact: null })
  const [locationPick, setLocationPick] = useState<{ clientId: string; value: string } | null>(null)
  const [errors, setErrors] = useState<{ title?: string; initialNote?: string }>({})
  const [saving, setSaving] = useState(false)

  const { locations, mainId, loading: locationsLoading } = useClientLocations(party.client?.id ?? null)
  const locationTouched = !!party.client && locationPick?.clientId === party.client.id
  const locationValue = locationTouched ? locationPick!.value : (mainId ?? "")

  const teamOptions = ticketTeamChoices(teams, { canAssign, canViewAll, defaultTeamId })
  const teamId = teamPick || defaultNewTicketTeamId(teams, defaultTeamId, { canAssign, canViewAll })
  const team = teams.find((t) => t.id === teamId) ?? null
  const assignees = assigneeFieldChoices(team?.assignableAssigneeIds ?? [], users)
  const typeId = typePick || firstByOrder(types)
  const priorityId = priorityPick || firstByOrder(priorities)

  // A new queue keeps the assignee only when they can be assigned there
  function changeTeam(nextId: string) {
    const next = teams.find((t) => t.id === nextId)
    setTeamPick(nextId)
    if (assigneeId && !next?.assignableAssigneeIds.includes(assigneeId)) setAssigneeId("")
  }

  async function handleSave() {
    const next: typeof errors = {}
    if (!title.trim()) next.title = "Title is required"
    // Required, judged on its text, not its markup
    if (isBlankHtml(initialNote)) next.initialNote = "Write an initial note"
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        clientId: party.client?.id ?? null,
        contactId: party.contact?.id ?? null,
        ...(locationTouched ? { clientLocationId: locationPick!.value || null } : {}),
        teamId: teamId || null,
        assigneeId: assigneeId || null,
        typeId: typeId || null,
        priorityId: priorityId || null,
        initialNote,
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok || typeof data.id !== "string") {
      setSaving(false)
      toast.error("Couldn't create the ticket", typeof data.error === "string" ? data.error : "Try again.")
      return
    }
    toast.success(`Ticket ${data.number} created`)
    onCreated({ id: data.id, number: data.number })
  }

  return (
    <Modal maxWidth="xl" scrollable onClose={saving ? undefined : onClose}>
      <div>
        <h2 className="text-xl font-bold tracking-[-0.01em] text-foreground">New ticket</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Starts unassigned unless you choose someone. Client and contact are optional.</p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
      >
        <div>
          <label htmlFor="new-ticket-title" className={LABEL}>
            Title <span className="text-danger">*</span>
          </label>
          <input
            id="new-ticket-title"
            value={title}
            maxLength={TICKET_TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value)
              setErrors((prev) => ({ ...prev, title: undefined }))
            }}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "new-ticket-title-error" : undefined}
            placeholder="For example: Outlook keeps asking for a password"
            className={FIELD}
            autoFocus
          />
          {errors.title && (
            <p id="new-ticket-title-error" className="mt-1 text-xs text-danger">
              {errors.title}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ClientContactPicker value={party} onChange={setParty} clients={clients} labelClassName={LABEL} />
          <div>
            <label htmlFor="new-ticket-location" className={LABEL}>
              Location
            </label>
            <select
              id="new-ticket-location"
              value={locationValue}
              disabled={!party.client || locationsLoading}
              onChange={(e) => party.client && setLocationPick({ clientId: party.client.id, value: e.target.value })}
              className={FIELD}
            >
              {!party.client ? (
                <option value="">Choose a client first</option>
              ) : locationsLoading ? (
                <option value={locationValue}>Loading locations...</option>
              ) : (
                <>
                  <option value="">{locations.length === 0 ? "This client has no locations" : "No location"}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.id === mainId ? " (main)" : ""}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          <div className="flex items-end">
            {party.client && (
              <Button type="button" variant="outline" size="sm" onClick={() => setParty({ client: null, contact: null })}>
                No client
              </Button>
            )}
          </div>

          <div>
            <label htmlFor="new-ticket-queue" className={LABEL}>
              Queue
            </label>
            <select id="new-ticket-queue" value={teamId} onChange={(e) => changeTeam(e.target.value)} disabled={teamOptions.length === 0} className={FIELD}>
              {teamOptions.length === 0 && <option value="">Loading...</option>}
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-ticket-assignee" className={LABEL}>
              Assignee
            </label>
            <select id="new-ticket-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-describedby={team?.roundRobinEnabled && !assigneeId ? "new-ticket-round-robin" : undefined} className={FIELD}>
              {assignees.map((a) => (
                <option key={a.value || "unassigned"} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            {team?.roundRobinEnabled && !assigneeId && (
              <p id="new-ticket-round-robin" className="mt-1 text-xs text-muted-foreground">
                {ROUND_ROBIN_NOTE}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="new-ticket-type" className={LABEL}>
              Type
            </label>
            <select id="new-ticket-type" value={typeId} onChange={(e) => setTypePick(e.target.value)} className={FIELD}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-ticket-priority" className={LABEL}>
              Priority
            </label>
            <select id="new-ticket-priority" value={priorityId} onChange={(e) => setPriorityPick(e.target.value)} className={FIELD}>
              {priorities.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className={LABEL}>
            Initial note <span className="text-danger">*</span>
          </p>
          <p className="mb-2 text-xs text-muted-foreground">Becomes the first entry on the timeline.</p>
          <RichTextEditor
            value={initialNote}
            onChange={(html) => {
              setInitialNote(html)
              setErrors((prev) => ({ ...prev, initialNote: undefined }))
            }}
            tall
            ariaLabel="Initial note (required)"
          />
          {errors.initialNote && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.initialNote}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="px-3.5" disabled={saving || !options.loaded}>
            {saving ? "Creating..." : "Create ticket"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
