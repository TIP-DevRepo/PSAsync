"use client"

import { useEffect, useState } from "react"
import { DndContext, closestCenter, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import {
  announcementsFor,
  DragHandle,
  errorOf,
  NameListSection,
  SectionError,
  SectionHeading,
  send,
  useReorderSensors,
} from "@/components/settings/OpportunitySettingsPanel"
import { TicketStatusPill } from "@/components/tickets/TicketPills"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { cn } from "@/lib/utils"
import { AUTO_CLOSE_DAYS_MAX, AUTO_CLOSE_DAYS_MESSAGE, TICKET_CATEGORY_LABELS, TICKET_NAME_MAX, TICKET_STATUS_CATEGORIES } from "@/lib/ticket-rules"
import type { TicketOption, TicketStatusOption } from "@/lib/ticket-view"
import type { TicketStatusCategory } from "@/generated/prisma"

const FIELD =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"

// Settings > Tickets (settingsSections.tickets): the company's ticket
// statuses, types, and priorities (each dragged to reorder, added, renamed,
// and deleted, a refused change shown as the API's own message), and the
// General settings: the number prefix, the queue new tickets go to, and how
// many days a resolved ticket waits before it closes by itself (0 is off).
// A status's category is chosen when it is added and never changes.
export function TicketSettingsPanel() {
  const { can } = useAccess()
  const allowed = can("settingsSections.tickets")
  const [statuses, setStatuses] = useState<TicketStatusOption[] | null>(null)
  const [types, setTypes] = useState<TicketOption[] | null>(null)
  const [priorities, setPriorities] = useState<TicketOption[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!allowed) return
    const json = (res: Response) => (res.ok ? res.json() : Promise.reject(new Error("refused")))
    fetch("/api/ticket-statuses").then(json).then(setStatuses).catch(() => setLoadFailed(true))
    fetch("/api/ticket-types").then(json).then(setTypes).catch(() => setLoadFailed(true))
    fetch("/api/ticket-priorities").then(json).then(setPriorities).catch(() => setLoadFailed(true))
  }, [allowed])

  if (!allowed) return <SettingsNoAccess />
  if (loadFailed) return <p className="text-sm text-danger">Couldn&apos;t load the ticket settings. Refresh to try again.</p>
  if (!statuses || !types || !priorities) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-10">
      <StatusesSection statuses={statuses} setStatuses={setStatuses} />
      <NameListSection
        items={priorities}
        setItems={setPriorities}
        listUrl="/api/ticket-priorities"
        reorderKey="priorityIds"
        noun="priority"
        plural="priorities"
        title="Priorities"
        description="From lowest to highest. The last one is the top priority: it shows in the danger color and its count is the list's top tile. The one before it shows in the warning color."
        placeholder="For example: Critical"
        maxLength={TICKET_NAME_MAX}
      />
      <NameListSection
        items={types}
        setItems={setTypes}
        listUrl="/api/ticket-types"
        reorderKey="typeIds"
        noun="type"
        title="Types"
        description="The kinds of ticket, in the order the type lists show them. The first is the default for a new ticket."
        placeholder="For example: Change Request"
        maxLength={TICKET_NAME_MAX}
      />
      <GeneralSection />
    </div>
  )
}

// ─── Statuses ───────────────────────────────────────────────────────────────

function StatusesSection({ statuses, setStatuses }: { statuses: TicketStatusOption[]; setStatuses: (s: TicketStatusOption[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newStatus, setNewStatus] = useState<{ name: string; category: TicketStatusCategory }>({ name: "", category: "OPEN" })
  const sensors = useReorderSensors()
  const statusName = (id: UniqueIdentifier) => statuses.find((s) => s.id === String(id))?.name ?? "status"

  async function reload() {
    const res = await fetch("/api/ticket-statuses")
    if (res.ok) setStatuses(await res.json())
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = statuses.findIndex((s) => s.id === active.id)
    const to = statuses.findIndex((s) => s.id === over.id)
    if (from < 0 || to < 0) return
    const previous = statuses
    const next = arrayMove(statuses, from, to)
    setStatuses(next)
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/ticket-statuses/reorder", "POST", { statusIds: next.map((s) => s.id) })
    setBusy(false)
    if (!ok) {
      setStatuses(previous)
      setError(errorOf(data, "Couldn't save the new status order."))
      return
    }
    setStatuses(data as TicketStatusOption[])
    toast.success("Status order saved")
  }

  async function handleAdd() {
    const name = newStatus.name.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/ticket-statuses", "POST", { name, category: newStatus.category })
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't add the status."))
      return
    }
    setNewStatus({ name: "", category: "OPEN" })
    toast.success(`Status ${name} added`)
    reload()
  }

  async function handleRename(status: TicketStatusOption) {
    const name = await promptDialog({ title: `Rename ${status.name}`, defaultValue: status.name, confirmLabel: "Save" })
    if (name === null || name === status.name) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/ticket-statuses/${status.id}`, "PATCH", { name })
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't rename the status."))
      return
    }
    toast.success("Status renamed")
    reload()
  }

  async function handleDelete(status: TicketStatusOption) {
    const confirmed = await confirmDialog({ title: `Delete the ${status.name} status?`, description: "This can't be undone.", confirmLabel: "Delete", variant: "danger" })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/ticket-statuses/${status.id}`, "DELETE")
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't delete the status."))
      return
    }
    toast.success(`Status ${status.name} deleted`)
    reload()
  }

  return (
    <section className="space-y-4" aria-labelledby="ticket-statuses-heading">
      <div id="ticket-statuses-heading">
        <SectionHeading title="Statuses">
          In this order in every status list. A status&apos;s category decides its color and what it means: Open and Waiting tickets still need work, Resolved ones close by
          themselves after the days below, and Closed ones are done. The category is chosen when a status is added and can&apos;t change. Every company keeps at least one
          status in each category.
        </SectionHeading>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      {/* DndContext renders hidden elements where it sits, so it wraps the list */}
      <DndContext id="ticket-statuses-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor(statusName) }}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {statuses.map((status) => (
              <StatusRow key={status.id} status={status} busy={busy} onRename={() => handleRename(status)} onDelete={() => handleDelete(status)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <div className="w-full sm:w-56">
          <label htmlFor="new-ticket-status-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            New status
          </label>
          <input
            id="new-ticket-status-name"
            value={newStatus.name}
            maxLength={TICKET_NAME_MAX}
            onChange={(e) => setNewStatus((p) => ({ ...p, name: e.target.value }))}
            placeholder="For example: Waiting on vendor"
            className={`${FIELD} w-full`}
          />
        </div>
        <div className="w-full sm:w-40">
          <label htmlFor="new-ticket-status-category" className="mb-1 block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="new-ticket-status-category"
            value={newStatus.category}
            onChange={(e) => setNewStatus((p) => ({ ...p, category: e.target.value as TicketStatusCategory }))}
            className={`${FIELD} w-full`}
          >
            {TICKET_STATUS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={busy || !newStatus.name.trim()}>
          Add status
        </Button>
      </form>
    </section>
  )
}

function StatusRow({ status, busy, onRename, onDelete }: { status: TicketStatusOption; busy: boolean; onRename: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: status.id, disabled: busy })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border bg-card py-1 pl-1 pr-3 text-sm", isDragging && "relative z-10 scale-[1.02] shadow-popover")}
    >
      <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${status.name}`} disabled={busy} />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={status.name}>
        {status.name}
      </span>
      {/* The category, read only: it is set when the status is added */}
      <TicketStatusPill name={TICKET_CATEGORY_LABELS[status.category]} category={status.category} className="shrink-0" />
      <button type="button" onClick={onRename} disabled={busy} className="text-xs font-medium text-primary hover:underline disabled:opacity-60">
        Rename
      </button>
      <button type="button" onClick={onDelete} disabled={busy} className="text-xs font-medium text-muted-foreground hover:text-danger disabled:opacity-60">
        Delete
      </button>
    </li>
  )
}

// ─── General ────────────────────────────────────────────────────────────────

interface TicketSettings {
  prefix: string
  defaultTeamId: string
  autoCloseResolvedDays: number
}

function GeneralSection() {
  const [settings, setSettings] = useState<TicketSettings | null>(null)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [prefix, setPrefix] = useState("")
  const [defaultTeamId, setDefaultTeamId] = useState("")
  const [days, setDays] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function fill(data: TicketSettings) {
    setSettings(data)
    setPrefix(data.prefix)
    setDefaultTeamId(data.defaultTeamId)
    setDays(String(data.autoCloseResolvedDays))
  }

  useEffect(() => {
    fetch("/api/ticket-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && fill(data))
      .catch(() => undefined)
    // The queues (GET /api/teams is open to settingsSections.tickets)
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setTeams(data))
      .catch(() => undefined)
  }, [])

  async function handleSave() {
    const text = days.trim()
    const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN
    if (!Number.isInteger(n) || n > AUTO_CLOSE_DAYS_MAX) {
      setError(AUTO_CLOSE_DAYS_MESSAGE)
      return
    }
    setSaving(true)
    setError(null)
    const { ok, data } = await send("/api/ticket-settings", "PATCH", { prefix: prefix.trim(), defaultTeamId, autoCloseResolvedDays: n })
    setSaving(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't save the ticket settings."))
      return
    }
    fill(data as unknown as TicketSettings)
    toast.success("Ticket settings saved")
  }

  const teamOptions = teams.some((t) => t.id === defaultTeamId) || !settings ? teams : [{ id: defaultTeamId, name: "Current queue" }, ...teams]

  return (
    <section className="space-y-4" aria-labelledby="ticket-general-heading">
      <div id="ticket-general-heading">
        <SectionHeading title="General">Numbering for new tickets, the queue they go to, and when resolved tickets close.</SectionHeading>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      {!settings ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <form
          className="space-y-4 rounded-md border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <div>
            <label htmlFor="ticket-prefix" className="mb-1 block text-sm font-medium text-foreground">
              Number prefix
            </label>
            <input id="ticket-prefix" value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} aria-describedby="ticket-prefix-help" className={`${FIELD} w-32`} />
            <p id="ticket-prefix-help" className="mt-1 text-xs text-muted-foreground">
              Letters, digits, and hyphens, up to 10 characters. New numbers look like {prefix.trim() || "T"}-{new Date().getFullYear()}-0001.
            </p>
          </div>
          <div>
            <label htmlFor="ticket-default-team" className="mb-1 block text-sm font-medium text-foreground">
              Default queue
            </label>
            <select id="ticket-default-team" value={defaultTeamId} onChange={(e) => setDefaultTeamId(e.target.value)} aria-describedby="ticket-default-team-help" className={`${FIELD} w-full sm:w-64`}>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p id="ticket-default-team-help" className="mt-1 text-xs text-muted-foreground">
              New tickets go here unless another queue is chosen. Anyone who can create tickets may use it.
            </p>
          </div>
          <div>
            <label htmlFor="ticket-auto-close" className="mb-1 block text-sm font-medium text-foreground">
              Close resolved tickets after (days)
            </label>
            <input id="ticket-auto-close" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-describedby="ticket-auto-close-help" className={`${FIELD} w-24 tabular-nums`} />
            <p id="ticket-auto-close-help" className="mt-1 text-xs text-muted-foreground">
              A whole number from 0 to {AUTO_CLOSE_DAYS_MAX}. 0 turns auto close off.
            </p>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </form>
      )}
    </section>
  )
}
