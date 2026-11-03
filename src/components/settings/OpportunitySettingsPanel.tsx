"use client"

import { useEffect, useState, type ReactNode } from "react"
import { GripVertical } from "lucide-react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { CATEGORY_LABELS, OPPORTUNITY_NAME_MAX, WIN_PROBABILITY_MESSAGE } from "@/lib/opportunity-rules"
import type { StageCategory, StageOption, TypeOption } from "@/lib/opportunity-view"
import { CategoryPill } from "@/components/opportunities/StagePill"
import { cn } from "@/lib/utils"

const FIELD =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const CATEGORIES: StageCategory[] = ["OPEN", "WON", "LOST"]

// The helpers below are shared with the Teams panel (TeamsSettingsPanel)
export async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | unknown[] }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

export const errorOf = (data: unknown, fallback: string) =>
  data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : fallback

// A whole number from 0 to 100, or null when the text isn't one
function readWinProbability(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const n = Number(text)
  return n <= 100 ? n : null
}

// Shown under a section's heading, in plain words: the API's own message
// for a refused change (a stage in use, the last Won stage, and so on)
export function SectionError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-medium underline">
        Dismiss
      </button>
    </div>
  )
}

export function DragHandle({ label, ...props }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: (el: HTMLElement | null) => void }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      className="flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-surface-hover hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}

export function useReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
}

export function announcementsFor(name: (id: UniqueIdentifier) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${name(over.id)}.` : `${name(active.id)} is no longer over the list.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} was dropped at ${name(over.id)}'s position.` : `${name(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  }
}

export function OpportunitySettingsPanel() {
  const [stages, setStages] = useState<StageOption[] | null>(null)
  const [types, setTypes] = useState<TypeOption[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const json = (res: Response) => (res.ok ? res.json() : Promise.reject(new Error("refused")))
    fetch("/api/opportunity-stages")
      .then(json)
      .then((data: StageOption[]) => setStages(data))
      .catch(() => setLoadFailed(true))
    fetch("/api/opportunity-types")
      .then(json)
      .then((data: TypeOption[]) => setTypes(data))
      .catch(() => setLoadFailed(true))
  }, [])

  if (loadFailed) return <p className="text-sm text-danger">Couldn&apos;t load the opportunity settings. Refresh to try again.</p>
  if (!stages || !types) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-10">
      <StagesSection stages={stages} setStages={setStages} />
      <TypesSection types={types} setTypes={setTypes} />
      <GeneralSection stages={stages} />
    </div>
  )
}

function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

// ─── Stages ─────────────────────────────────────────────────────────────────

function StagesSection({ stages, setStages }: { stages: StageOption[]; setStages: (stages: StageOption[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newStage, setNewStage] = useState({ name: "", category: "OPEN" as StageCategory, winProbability: "" })
  const sensors = useReorderSensors()

  const stageName = (id: UniqueIdentifier) => stages.find((s) => s.id === String(id))?.name ?? "stage"

  async function reload() {
    const res = await fetch("/api/opportunity-stages")
    if (res.ok) setStages(await res.json())
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = stages.findIndex((s) => s.id === active.id)
    const to = stages.findIndex((s) => s.id === over.id)
    if (from < 0 || to < 0) return
    const previous = stages
    const next = arrayMove(stages, from, to)
    setStages(next)
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/opportunity-stages/reorder", "POST", { stageIds: next.map((s) => s.id) })
    setBusy(false)
    if (!ok) {
      setStages(previous)
      setError(errorOf(data, "Couldn't save the new stage order."))
      return
    }
    setStages(data as StageOption[])
    toast.success("Stage order saved")
  }

  async function handleAdd() {
    const name = newStage.name.trim()
    if (!name) return
    const winProbability = newStage.winProbability.trim() === "" ? undefined : readWinProbability(newStage.winProbability)
    if (winProbability === null) {
      setError(WIN_PROBABILITY_MESSAGE)
      return
    }
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/opportunity-stages", "POST", { name, category: newStage.category, winProbability })
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't add the stage."))
      return
    }
    setNewStage({ name: "", category: "OPEN", winProbability: "" })
    toast.success(`Stage ${name} added`)
    reload()
  }

  async function handleSave(stage: StageOption, draft: { name: string; category: StageCategory; winProbability: string }) {
    const winProbability = readWinProbability(draft.winProbability)
    if (winProbability === null) {
      setError(WIN_PROBABILITY_MESSAGE)
      return
    }
    const patch: Record<string, unknown> = {}
    if (draft.name.trim() !== stage.name) patch.name = draft.name.trim()
    if (draft.category !== stage.category) patch.category = draft.category
    if (winProbability !== stage.winProbability) patch.winProbability = winProbability
    if (Object.keys(patch).length === 0) {
      setEditingId(null)
      return
    }
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/opportunity-stages/${stage.id}`, "PATCH", patch)
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't save the stage."))
      return
    }
    setEditingId(null)
    toast.success("Stage saved")
    reload()
  }

  async function handleDelete(stage: StageOption) {
    const confirmed = await confirmDialog({
      title: `Delete the ${stage.name} stage?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/opportunity-stages/${stage.id}`, "DELETE")
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't delete the stage."))
      return
    }
    toast.success(`Stage ${stage.name} deleted`)
    reload()
  }

  return (
    <section className="space-y-4" aria-labelledby="opportunity-stages-heading">
      <div id="opportunity-stages-heading">
        <SectionHeading title="Stages">
          The columns of the Opportunities board, in this order. Drag a stage by its handle to move it. Every company keeps at least one Open, one Won, and one Lost stage.
        </SectionHeading>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      {/* Fixed column widths, scrolling sideways on a narrow screen. DndContext renders hidden
          accessibility elements where it sits, so it wraps the table, never goes inside it. */}
      <DndContext id="opportunity-stages-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor(stageName) }}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: 48 }} />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-caption text-muted-foreground">
                <th scope="col" className="py-2 pl-2">
                  <span className="sr-only">Order</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  Name
                </th>
                <th scope="col" className="py-2 pr-3">
                  Category
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Win probability
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {stages.map((stage) => (
                  <StageRow
                    key={stage.id}
                    stage={stage}
                    editing={editingId === stage.id}
                    busy={busy}
                    onEdit={() => {
                      setError(null)
                      setEditingId(stage.id)
                    }}
                    onCancel={() => setEditingId(null)}
                    onSave={(draft) => handleSave(stage, draft)}
                    onDelete={() => handleDelete(stage)}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </div>
      </DndContext>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <div className="w-full sm:w-56">
          <label htmlFor="new-stage-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            New stage
          </label>
          <input
            id="new-stage-name"
            value={newStage.name}
            maxLength={OPPORTUNITY_NAME_MAX}
            onChange={(e) => setNewStage((p) => ({ ...p, name: e.target.value }))}
            placeholder="For example: Discovery"
            className={`${FIELD} w-full`}
          />
        </div>
        <div className="w-full sm:w-32">
          <label htmlFor="new-stage-category" className="mb-1 block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="new-stage-category"
            value={newStage.category}
            onChange={(e) => setNewStage((p) => ({ ...p, category: e.target.value as StageCategory }))}
            className={`${FIELD} w-full`}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-36">
          <label htmlFor="new-stage-win" className="mb-1 block text-xs font-medium text-muted-foreground">
            Win probability (%)
          </label>
          <input
            id="new-stage-win"
            inputMode="numeric"
            value={newStage.winProbability}
            onChange={(e) => setNewStage((p) => ({ ...p, winProbability: e.target.value }))}
            placeholder={newStage.category === "WON" ? "100" : "0"}
            className={`${FIELD} w-full tabular-nums`}
          />
        </div>
        <Button type="submit" disabled={busy || !newStage.name.trim()}>
          Add stage
        </Button>
      </form>
    </section>
  )
}

function StageRow({
  stage,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  stage: StageOption
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (draft: { name: string; category: StageCategory; winProbability: string }) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: busy || editing })
  const [draft, setDraft] = useState({ name: stage.name, category: stage.category, winProbability: String(stage.winProbability) })

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("border-b border-border last:border-0", isDragging ? "relative z-10 bg-card shadow-popover" : "bg-card")}
    >
      <td className="py-2 pl-2">
        <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${stage.name}`} disabled={busy || editing} />
      </td>
      {editing ? (
        <>
          <td className="py-2 pr-3">
            <input
              aria-label="Stage name"
              value={draft.name}
              maxLength={OPPORTUNITY_NAME_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={`${FIELD} w-full`}
              autoFocus
            />
          </td>
          <td className="py-2 pr-3">
            <select
              aria-label="Stage category"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as StageCategory }))}
              className={`${FIELD} w-full`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </td>
          <td className="py-2 pr-3">
            <input
              aria-label="Win probability (%)"
              inputMode="numeric"
              value={draft.winProbability}
              onChange={(e) => setDraft((d) => ({ ...d, winProbability: e.target.value }))}
              className={`${FIELD} w-full text-right tabular-nums`}
            />
          </td>
          <td className="py-2 pr-3">
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => onSave(draft)} disabled={busy || !draft.name.trim()}>
                Save
              </Button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="truncate py-2 pr-3 font-medium text-foreground" title={stage.name}>
            {stage.name}
          </td>
          <td className="py-2 pr-3">
            <CategoryPill category={stage.category} />
          </td>
          <td className="py-2 pr-3 text-right tabular-nums text-foreground">{stage.winProbability}%</td>
          <td className="py-2 pr-3">
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  // Starts from the stage as saved now
                  setDraft({ name: stage.name, category: stage.category, winProbability: String(stage.winProbability) })
                  onEdit()
                }}
                disabled={busy}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
              >
                Edit
              </button>
              <button type="button" onClick={onDelete} disabled={busy} className="text-xs font-medium text-muted-foreground hover:text-danger disabled:opacity-60">
                Delete
              </button>
            </div>
          </td>
        </>
      )}
    </tr>
  )
}

// ─── Types ──────────────────────────────────────────────────────────────────

function TypesSection({ types, setTypes }: { types: TypeOption[]; setTypes: (types: TypeOption[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState("")
  const sensors = useReorderSensors()

  const typeName = (id: UniqueIdentifier) => types.find((t) => t.id === String(id))?.name ?? "type"

  async function reload() {
    const res = await fetch("/api/opportunity-types")
    if (res.ok) setTypes(await res.json())
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = types.findIndex((t) => t.id === active.id)
    const to = types.findIndex((t) => t.id === over.id)
    if (from < 0 || to < 0) return
    const previous = types
    const next = arrayMove(types, from, to)
    setTypes(next)
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/opportunity-types/reorder", "POST", { typeIds: next.map((t) => t.id) })
    setBusy(false)
    if (!ok) {
      setTypes(previous)
      setError(errorOf(data, "Couldn't save the new type order."))
      return
    }
    setTypes(data as TypeOption[])
    toast.success("Type order saved")
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/opportunity-types", "POST", { name })
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't add the type."))
      return
    }
    setNewName("")
    toast.success(`Type ${name} added`)
    reload()
  }

  async function handleRename(type: TypeOption) {
    const name = await promptDialog({ title: `Rename ${type.name}`, defaultValue: type.name, confirmLabel: "Save" })
    if (name === null || name === type.name) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/opportunity-types/${type.id}`, "PATCH", { name })
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't rename the type."))
      return
    }
    toast.success("Type renamed")
    reload()
  }

  async function handleDelete(type: TypeOption) {
    const confirmed = await confirmDialog({
      title: `Delete the ${type.name} type?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/opportunity-types/${type.id}`, "DELETE")
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't delete the type."))
      return
    }
    toast.success(`Type ${type.name} deleted`)
    reload()
  }

  return (
    <section className="space-y-4" aria-labelledby="opportunity-types-heading">
      <div id="opportunity-types-heading">
        <SectionHeading title="Types">The kinds of deal an opportunity can be, in the order the type lists show them.</SectionHeading>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      <DndContext id="opportunity-types-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor(typeName) }}>
        <SortableContext items={types.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {types.map((type) => (
              <TypeRow key={type.id} type={type} busy={busy} onRename={() => handleRename(type)} onDelete={() => handleDelete(type)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {types.length === 0 && <p className="text-sm text-muted-foreground">No types yet. Add one below.</p>}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <label htmlFor="new-type-name" className="sr-only">
          New type
        </label>
        <input
          id="new-type-name"
          value={newName}
          maxLength={OPPORTUNITY_NAME_MAX}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="For example: Managed Services"
          className={`${FIELD} min-w-0 flex-1 sm:max-w-sm`}
        />
        <Button type="submit" disabled={busy || !newName.trim()}>
          Add type
        </Button>
      </form>
    </section>
  )
}

function TypeRow({ type, busy, onRename, onDelete }: { type: TypeOption; busy: boolean; onRename: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: type.id, disabled: busy })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border bg-card py-1 pl-1 pr-3 text-sm", isDragging && "relative z-10 scale-[1.02] shadow-popover")}
    >
      <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${type.name}`} disabled={busy} />
      <span className="min-w-0 flex-1 truncate text-foreground" title={type.name}>
        {type.name}
      </span>
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

function GeneralSection({ stages }: { stages: StageOption[] }) {
  const [settings, setSettings] = useState<{ prefix: string; quoteSentStageId: string | null } | null>(null)
  const [prefix, setPrefix] = useState("")
  const [quoteSentStageId, setQuoteSentStageId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/opportunity-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        setSettings(data)
        setPrefix(data.prefix)
        setQuoteSentStageId(data.quoteSentStageId ?? "")
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const { ok, data } = await send("/api/opportunity-settings", "PATCH", { prefix: prefix.trim(), quoteSentStageId: quoteSentStageId || null })
    setSaving(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't save the opportunity settings."))
      return
    }
    const saved = data as { prefix: string; quoteSentStageId: string | null }
    setSettings(saved)
    setPrefix(saved.prefix)
    setQuoteSentStageId(saved.quoteSentStageId ?? "")
    toast.success("Opportunity settings saved")
  }

  // Only Open stages can be the one a sent quote moves to. The saved one
  // stays listed even if it is no longer Open, so the field shows it.
  const openStages = stages.filter((s) => s.category === "OPEN" || s.id === settings?.quoteSentStageId)

  return (
    <section className="space-y-4" aria-labelledby="opportunity-general-heading">
      <div id="opportunity-general-heading">
        <SectionHeading title="General">Numbering for new opportunities, and where an opportunity moves when one of its quotes is sent.</SectionHeading>
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
            <label htmlFor="opportunity-prefix" className="mb-1 block text-sm font-medium text-foreground">
              Number prefix
            </label>
            <input id="opportunity-prefix" value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} aria-describedby="opportunity-prefix-help" className={`${FIELD} w-32`} />
            <p id="opportunity-prefix-help" className="mt-1 text-xs text-muted-foreground">
              Letters, digits, and hyphens, up to 10 characters. New numbers look like {prefix.trim() || "OPP"}-{new Date().getFullYear()}-0001.
            </p>
          </div>
          <div>
            <label htmlFor="opportunity-quote-sent-stage" className="mb-1 block text-sm font-medium text-foreground">
              Stage when a quote is sent
            </label>
            <select
              id="opportunity-quote-sent-stage"
              value={quoteSentStageId}
              onChange={(e) => setQuoteSentStageId(e.target.value)}
              className={`${FIELD} w-full sm:w-64`}
            >
              <option value="">Don&apos;t move the opportunity</option>
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </form>
      )}
    </section>
  )
}
