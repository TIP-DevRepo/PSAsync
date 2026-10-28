"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { OPPORTUNITY_TITLE_MAX, readExpectedValue } from "@/lib/opportunity-rules"
import { ownerFieldChoices, teamChoices, type StageOption, type TypeOption } from "@/lib/opportunity-view"
import { canSeeOpportunity, defaultNewOpportunityTeamId, INVISIBLE_AFTER_SAVE_MESSAGE, type TeamSummary } from "@/lib/team-rules"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { isBlankHtml } from "@/lib/timeline-actions"
import { ClientContactPicker } from "@/components/ClientContactPicker"
import { useClientLocations } from "./useClientLocations"
import type { ClientContactValue } from "@/lib/client-contact-choice"

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-sm font-medium text-foreground"

export function NewOpportunityModal({
  stages,
  types,
  clients,
  teams,
  users,
  onClose,
  onCreated,
}: {
  stages: StageOption[]
  types: TypeOption[]
  clients: { id: string; name: string }[]
  // GET /api/teams and GET /api/users, loaded by the page
  teams: TeamSummary[]
  users: { id: string; name: string; active: boolean }[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { access, can } = useAccess()
  const canViewAll = can("opportunities.viewAll")
  // Shown when the chosen team and owner would hide the new opportunity
  // from its creator; Save anyway goes ahead
  const [invisibleWarning, setInvisibleWarning] = useState(false)

  const [form, setForm] = useState({
    title: "",
    // "" until the user picks one: the page's team filter when allowed, else General
    teamId: "",
    // New records start unassigned (""); the user picks an owner if needed
    ownerId: "",
    stageId: stages.find((s) => s.category === "OPEN")?.id ?? "",
    typeId: "",
    expectedValue: "",
    expectedCloseDate: "",
  })
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form | "clientId" | "contactId" | "initialNote", string>>>({})
  const [saving, setSaving] = useState(false)
  const [initialNote, setInitialNote] = useState("")
  // Picking a contact also sets its client (ClientContactPicker)
  const [party, setParty] = useState<ClientContactValue>({ client: null, contact: null })
  // The location the user picked for the current client ("" for none).
  // Untouched, the select shows the client's main location and the request
  // leaves it out, so the server saves the main location.
  const [locationPick, setLocationPick] = useState<{ clientId: string; value: string } | null>(null)
  const { locations, mainId, loading: locationsLoading } = useClientLocations(party.client?.id ?? null)
  const locationTouched = !!party.client && locationPick?.clientId === party.client.id
  const locationValue = locationTouched ? locationPick!.value : (mainId ?? "")

  // The teams the user may put it in: their own teams, every team with
  // viewAll, and General always. It starts on General when the user is in
  // it (or sees every team), else their first team, else General
  // (defaultNewOpportunityTeamId). Owners are Unassigned and the chosen
  // team's members the user may assign (ownerFieldChoices).
  const teamOptions = teamChoices(teams, canViewAll, { includeDefault: true })
  const teamId = form.teamId || defaultNewOpportunityTeamId(teams, canViewAll)
  const team = teams.find((t) => t.id === teamId) ?? null

  // Changing the team clears an owner who isn't one of its members
  function changeTeam(nextId: string) {
    const next = teams.find((t) => t.id === nextId)
    setForm((prev) => ({ ...prev, teamId: nextId, ownerId: prev.ownerId && next?.assignableOwnerIds.includes(prev.ownerId) ? prev.ownerId : "" }))
    setInvisibleWarning(false)
  }

  const update = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === "ownerId") setInvisibleWarning(false)
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function validate() {
    const next: typeof errors = {}
    if (!form.title.trim()) next.title = "Title is required"
    if (!party.client) next.clientId = "Choose a client"
    if (!party.contact) next.contactId = "Choose a contact"
    // Required, judged on its text, not its markup (the editor sends <p></p> when empty)
    if (isBlankHtml(initialNote)) next.initialNote = "Write an initial note"
    const value = readExpectedValue(form.expectedValue.trim())
    if (value.error !== undefined) next.expectedValue = value.error
    setErrors(next)
    return Object.keys(next).length === 0
  }

  // The same rule as the server's opportunityVisibilityWhere (canSeeOpportunity)
  const visibleAfterSave = canSeeOpportunity(
    {
      userId: access?.userId ?? "",
      canOpenPage: can("pages.opportunities"),
      canViewAll,
      canViewTeam: can("opportunities.viewTeam"),
    },
    { ownerId: form.ownerId || null, viewerInTeam: !!team?.isMember }
  )

  async function handleSave(confirmedInvisible = false) {
    if (!validate()) return
    if (!visibleAfterSave && !confirmedInvisible) {
      setInvisibleWarning(true)
      return
    }
    setInvisibleWarning(false)
    setSaving(true)
    const res = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        clientId: party.client?.id,
        contactId: party.contact?.id,
        ...(locationTouched ? { clientLocationId: locationPick!.value || null } : {}),
        teamId: teamId || null,
        ownerId: form.ownerId || null,
        stageId: form.stageId || null,
        typeId: form.typeId || null,
        expectedValue: form.expectedValue.trim() || null,
        expectedCloseDate: form.expectedCloseDate || null,
        // The first note on the timeline, saved with the opportunity
        initialNote,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || typeof data.id !== "string") {
      setSaving(false)
      toast.error("Couldn't create the opportunity", data.error)
      return
    }
    toast.success(`Opportunity ${data.number} created`)
    onCreated(data.id)
  }

  const owners = ownerFieldChoices(team?.assignableOwnerIds ?? [], users)
  const fieldError = (field: keyof typeof form) =>
    errors[field] ? (
      <p id={`new-opportunity-${field}-error`} className="mt-1 text-xs text-danger">
        {errors[field]}
      </p>
    ) : null
  const describedBy = (field: keyof typeof form) => (errors[field] ? `new-opportunity-${field}-error` : undefined)

  return (
    <Modal maxWidth="xl" scrollable onClose={saving ? undefined : onClose}>
      <h2 className="text-lg font-bold text-foreground">New opportunity</h2>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
      >
        <div>
          <label htmlFor="new-opportunity-title" className={LABEL}>
            Title <span className="text-danger">*</span>
          </label>
          <input
            id="new-opportunity-title"
            value={form.title}
            maxLength={OPPORTUNITY_TITLE_MAX}
            onChange={(e) => update("title", e.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby={describedBy("title")}
            placeholder="For example: Office network refresh"
            className={FIELD}
            autoFocus
          />
          {fieldError("title")}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ClientContactPicker
            value={party}
            onChange={(next) => {
              setParty(next)
              setErrors((prev) => ({ ...prev, clientId: undefined, contactId: undefined }))
            }}
            clients={clients}
            required
            labelClassName={LABEL}
            errors={{ client: errors.clientId, contact: errors.contactId }}
          />
          <div>
            <label htmlFor="new-opportunity-location" className={LABEL}>
              Location
            </label>
            <select
              id="new-opportunity-location"
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

          <div>
            <label htmlFor="new-opportunity-team" className={LABEL}>
              Team
            </label>
            <select id="new-opportunity-team" value={teamId} onChange={(e) => changeTeam(e.target.value)} disabled={teamOptions.length === 0} className={FIELD}>
              {teamOptions.length === 0 && <option value="">Loading...</option>}
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-opportunity-owner" className={LABEL}>
              Owner
            </label>
            <select id="new-opportunity-owner" value={form.ownerId} onChange={(e) => update("ownerId", e.target.value)} className={FIELD}>
              {/* An owner shows by name once the user list loads */}
              {!owners.some((o) => o.value === form.ownerId) && <option value={form.ownerId}>Loading...</option>}
              {owners.map((o) => (
                <option key={o.value || "unassigned"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-opportunity-stage" className={LABEL}>
              Stage
            </label>
            <select id="new-opportunity-stage" value={form.stageId} onChange={(e) => update("stageId", e.target.value)} className={FIELD}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="new-opportunity-type" className={LABEL}>
              Type
            </label>
            <select id="new-opportunity-type" value={form.typeId} onChange={(e) => update("typeId", e.target.value)} className={FIELD}>
              <option value="">None</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-opportunity-value" className={LABEL}>
              Expected value
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                id="new-opportunity-value"
                inputMode="decimal"
                value={form.expectedValue}
                onChange={(e) => update("expectedValue", e.target.value)}
                aria-invalid={!!errors.expectedValue}
                aria-describedby={describedBy("expectedValue")}
                placeholder="0.00"
                className={`${FIELD} pl-6 tabular-nums`}
              />
            </div>
            {fieldError("expectedValue")}
          </div>

          <div>
            <label htmlFor="new-opportunity-close" className={LABEL}>
              Expected close date
            </label>
            <input
              id="new-opportunity-close"
              type="date"
              value={form.expectedCloseDate}
              onChange={(e) => update("expectedCloseDate", e.target.value)}
              className={FIELD}
            />
          </div>
        </div>

        <div>
          <p id="new-opportunity-note-label" className={LABEL}>
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

        {invisibleWarning && !visibleAfterSave ? (
          <div role="alert" className="space-y-3 rounded-md bg-warning/10 px-3 py-3 text-sm text-foreground">
            <p>{INVISIBLE_AFTER_SAVE_MESSAGE}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setInvisibleWarning(false)} disabled={saving} autoFocus>
                Go back
              </Button>
              <Button type="button" onClick={() => handleSave(true)} disabled={saving}>
                {saving ? "Creating..." : "Save anyway"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create opportunity"}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  )
}
