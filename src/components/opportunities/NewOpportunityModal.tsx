"use client"

import { useEffect, useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { OPPORTUNITY_TITLE_MAX, readExpectedValue } from "@/lib/opportunity-rules"
import { ownerFieldChoices, type StageOption, type TypeOption } from "@/lib/opportunity-view"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { isBlankHtml } from "@/lib/timeline-actions"
import { useClientContacts } from "./useClientContacts"

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-sm font-medium text-foreground"

export function NewOpportunityModal({
  stages,
  types,
  clients,
  onClose,
  onCreated,
}: {
  stages: StageOption[]
  types: TypeOption[]
  clients: { id: string; name: string }[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { access, can } = useAccess()
  const myUserId = access?.userId ?? null
  const canViewAll = can("opportunities.viewAll")

  const [users, setUsers] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [form, setForm] = useState({
    title: "",
    clientId: "",
    contactId: "",
    // Me by default; "" is unassigned
    ownerId: myUserId ?? "",
    stageId: stages.find((s) => s.category === "OPEN")?.id ?? "",
    typeId: "",
    expectedValue: "",
    expectedCloseDate: "",
  })
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({})
  const [saving, setSaving] = useState(false)
  const [initialNote, setInitialNote] = useState("")
  const { contacts, loading: contactsLoading } = useClientContacts(form.clientId)

  // Every user's name (the current user shows by name too); who may be
  // chosen is decided by ownerFieldChoices
  useEffect(() => {
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setUsers(data))
  }, [])

  const update = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      // A contact belongs to one client, so a new client clears it
      ...(field === "clientId" ? { contactId: "" } : {}),
    }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function validate() {
    const next: typeof errors = {}
    if (!form.title.trim()) next.title = "Title is required"
    if (!form.clientId) next.clientId = "Choose a client"
    if (!form.contactId) next.contactId = "Choose a contact"
    const value = readExpectedValue(form.expectedValue.trim())
    if (value.error !== undefined) next.expectedValue = value.error
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    const res = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        clientId: form.clientId,
        contactId: form.contactId,
        ownerId: form.ownerId || null,
        stageId: form.stageId || null,
        typeId: form.typeId || null,
        expectedValue: form.expectedValue.trim() || null,
        expectedCloseDate: form.expectedCloseDate || null,
        // The first note on the timeline, saved with the opportunity
        initialNote: isBlankHtml(initialNote) ? null : initialNote,
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

  const owners = ownerFieldChoices(canViewAll, users, myUserId)
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
          <div>
            <label htmlFor="new-opportunity-client" className={LABEL}>
              Client <span className="text-danger">*</span>
            </label>
            <select
              id="new-opportunity-client"
              value={form.clientId}
              onChange={(e) => update("clientId", e.target.value)}
              aria-invalid={!!errors.clientId}
              aria-describedby={describedBy("clientId")}
              className={FIELD}
            >
              <option value="">Choose a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldError("clientId")}
          </div>
          <div>
            <label htmlFor="new-opportunity-contact" className={LABEL}>
              Contact <span className="text-danger">*</span>
            </label>
            <select
              id="new-opportunity-contact"
              value={form.contactId}
              onChange={(e) => update("contactId", e.target.value)}
              disabled={!form.clientId || contactsLoading}
              aria-invalid={!!errors.contactId}
              aria-describedby={describedBy("contactId")}
              className={FIELD}
            >
              <option value="">
                {!form.clientId ? "Choose a client first" : contactsLoading ? "Loading contacts..." : contacts.length === 0 ? "This client has no contacts" : "Choose a contact"}
              </option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
            {fieldError("contactId")}
          </div>

          <div>
            <label htmlFor="new-opportunity-owner" className={LABEL}>
              Owner
            </label>
            <select id="new-opportunity-owner" value={form.ownerId} onChange={(e) => update("ownerId", e.target.value)} className={FIELD}>
              {/* The current user (the default) shows by name once the user list loads */}
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
            Initial note
          </p>
          <p className="mb-2 text-xs text-muted-foreground">Becomes the first entry on the timeline. Optional.</p>
          <RichTextEditor value={initialNote} onChange={setInitialNote} tall ariaLabel="Initial note" />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create opportunity"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
