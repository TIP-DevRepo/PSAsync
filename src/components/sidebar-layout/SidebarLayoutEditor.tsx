"use client"

import { useRef, type KeyboardEvent } from "react"
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardHeader } from "@/components/ui/blocks"
import { Switch } from "@/components/appearance/AppearanceControls"
import { announcementsFor, DragHandle, useReorderSensors } from "@/components/settings/OpportunitySettingsPanel"
import {
  OPPORTUNITY_DEFAULT_VIEWS,
  OPPORTUNITY_VIEW_LABELS,
  orderTeams,
  replaceVisibleOrder,
  SIDEBAR_FOLDER_KEYS,
  SIDEBAR_FOLDER_LABELS,
  SIDEBAR_SECTIONS,
  TICKET_DEFAULT_VIEWS,
  TICKET_VIEW_LABELS,
  type SidebarFolderKey,
  type SidebarItemDef,
  type SidebarLayout,
} from "@/lib/sidebar-layout"

export interface SidebarEditorTeam {
  id: string
  name: string
}

// The controls Settings > Sidebar and My settings > Sidebar share: the
// pages of each section and the teams of each folder in order (dragged, or
// moved with the Move up and Move down buttons from the keyboard), each
// folder's "Open by default" switch, and the Opportunities and Tickets
// default views. `value` is a full layout (layoutFromResolved); every change
// hands back a full layout, and the page decides what to save. Read only,
// it shows the same layout with nothing to change.
export function SidebarLayoutEditor({
  idBase,
  value,
  onChange,
  readOnly = false,
  canSeeItem,
  folderTeams,
}: {
  idBase: string
  value: SidebarLayout
  onChange: (next: SidebarLayout) => void
  readOnly?: boolean
  // Which pages to list (My settings lists only the user's own pages)
  canSeeItem: (item: SidebarItemDef) => boolean
  // Each folder's teams in their own order; a folder left out isn't shown
  folderTeams: Partial<Record<SidebarFolderKey, SidebarEditorTeam[] | null>>
}) {
  const shownFolders = SIDEBAR_FOLDER_KEYS.filter((key) => key in folderTeams)
  const showOpportunityView = "opportunities" in folderTeams
  const showTicketView = "tickets" in folderTeams

  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="flex flex-col gap-4">
        <CardHeader
          title="Pages"
          description={readOnly ? "The order of the pages in each section." : "Drag a page, or use its Move up and Move down buttons, to change its place in its section."}
        />
        {SIDEBAR_SECTIONS.map((section) => {
          const full = value.sections?.[section.key] ?? section.items.map((i) => i.key)
          const byKey = new Map(section.items.map((i) => [i.key, i]))
          const visible = full.map((key) => byKey.get(key)).filter((item): item is SidebarItemDef => !!item && canSeeItem(item))
          if (visible.length === 0) return null
          return (
            <OrderList
              key={section.key}
              id={`${idBase}-section-${section.key}`}
              title={section.label}
              items={visible.map((item) => ({ id: item.key, name: item.label }))}
              readOnly={readOnly}
              onReorder={(ids) => onChange({ ...value, sections: { ...value.sections, [section.key]: replaceVisibleOrder(full, ids) } })}
            />
          )
        })}
      </Card>

      {shownFolders.length > 0 && (
        <Card className="flex flex-col gap-5">
          <CardHeader
            title="Folders"
            description="Tickets and Opportunities open into their teams. Choose the order of the teams and whether the folder starts open. Once someone opens or closes a folder, their browser remembers their choice."
          />
          {shownFolders.map((key, i) => {
            const folder = value.folders?.[key] ?? {}
            const teams = folderTeams[key]
            const ordered = teams ? orderTeams(teams, folder.teamOrder ?? []) : []
            const setFolder = (patch: { teamOrder?: string[]; openByDefault?: boolean }) =>
              onChange({ ...value, folders: { ...value.folders, [key]: { ...folder, ...patch } } })
            return (
              <div key={key} className={cn("flex flex-col gap-3", i > 0 && "border-t border-border pt-4")}>
                {readOnly ? (
                  <div>
                    <p className="text-sm font-semibold text-foreground">{SIDEBAR_FOLDER_LABELS[key]}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{folder.openByDefault ? "Starts open" : "Starts closed"}</p>
                  </div>
                ) : (
                  <Switch
                    id={`${idBase}-folder-${key}-open`}
                    checked={folder.openByDefault === true}
                    onChange={(open) => setFolder({ openByDefault: open })}
                    label={`${SIDEBAR_FOLDER_LABELS[key]}: Open by default`}
                    description="The folder shows its teams until it is closed."
                  />
                )}
                {teams === null ? (
                  <p className="text-sm text-muted-foreground">Loading teams...</p>
                ) : ordered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No teams to order yet.</p>
                ) : (
                  <OrderList
                    id={`${idBase}-folder-${key}-teams`}
                    title={`${SIDEBAR_FOLDER_LABELS[key]} teams`}
                    items={ordered}
                    readOnly={readOnly}
                    onReorder={(ids) => setFolder({ teamOrder: ids })}
                  />
                )}
              </div>
            )
          })}
        </Card>
      )}

      {(showOpportunityView || showTicketView) && (
        <Card className="flex flex-col gap-4">
          <CardHeader title="Default views" description="The view a page opens on when its link doesn't already choose one. Switching views on the page works as before." />
          {showOpportunityView && (
            <RadioRow
              label="Opportunities"
              options={OPPORTUNITY_DEFAULT_VIEWS}
              labels={OPPORTUNITY_VIEW_LABELS}
              value={value.defaultViews?.opportunities ?? "board"}
              readOnly={readOnly}
              onChange={(view) => onChange({ ...value, defaultViews: { ...value.defaultViews, opportunities: view } })}
            />
          )}
          {showTicketView && (
            <RadioRow
              label="Tickets"
              options={TICKET_DEFAULT_VIEWS}
              labels={TICKET_VIEW_LABELS}
              value={value.defaultViews?.tickets ?? "open"}
              readOnly={readOnly}
              onChange={(view) => onChange({ ...value, defaultViews: { ...value.defaultViews, tickets: view } })}
            />
          )}
        </Card>
      )}
    </div>
  )
}

// ─── An ordered list ────────────────────────────────────────────────────────

function OrderList({
  id,
  title,
  items,
  readOnly,
  onReorder,
}: {
  id: string
  title: string
  items: SidebarEditorTeam[]
  readOnly: boolean
  onReorder: (ids: string[]) => void
}) {
  const sensors = useReorderSensors()
  const ids = items.map((i) => i.id)
  const nameOf = (itemId: string | number) => items.find((i) => i.id === itemId)?.name ?? "Item"

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length || from === to) return
    onReorder(arrayMove(ids, from, to))
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
  }

  const heading = (
    <p id={`${id}-label`} className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {title}
    </p>
  )

  if (readOnly) {
    return (
      <div className="flex flex-col gap-1.5">
        {heading}
        <ol aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
              {item.name}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {heading}
      {/* DndContext renders hidden elements, so it wraps the list rather than sitting in it */}
      <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor((v) => nameOf(v)) }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
            {items.map((item, index) => (
              <OrderRow key={item.id} item={item} index={index} count={items.length} onMove={move} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  )
}

const MOVE_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"

function OrderRow({ item, index, count, onMove }: { item: SidebarEditorTeam; index: number; count: number; onMove: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border bg-card py-1 pl-1 pr-1 text-sm", isDragging && "relative z-10 scale-[1.02] shadow-popover")}
    >
      <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${item.name}`} />
      <span className="min-w-0 flex-1 truncate text-foreground" title={item.name}>
        {item.name}
      </span>
      <button type="button" className={MOVE_BUTTON} aria-label={`Move ${item.name} up`} title="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
        <ArrowUp size={15} aria-hidden="true" />
      </button>
      <button type="button" className={MOVE_BUTTON} aria-label={`Move ${item.name} down`} title="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
        <ArrowDown size={15} aria-hidden="true" />
      </button>
    </li>
  )
}

// ─── A choice of views ──────────────────────────────────────────────────────

function RadioRow<T extends string>({
  label,
  options,
  labels,
  value,
  readOnly,
  onChange,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  readOnly: boolean
  onChange: (value: T) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  if (readOnly) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-28 shrink-0 text-sm font-semibold text-foreground">{label}</span>
        <span className="text-sm text-foreground">{labels[value]}</span>
      </div>
    )
  }

  // Arrow keys, Home, and End move the choice, like the Appearance switches
  function onKeyDown(e: KeyboardEvent) {
    const i = Math.max(0, options.indexOf(value))
    let next = i
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = options.length - 1
    else return
    e.preventDefault()
    onChange(options[next])
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="w-28 shrink-0 text-sm font-semibold text-foreground">{label}</span>
      <div role="radiogroup" aria-label={`${label} default view`} className="inline-flex flex-wrap gap-1 rounded-[10px] border border-border bg-surface-2 p-1">
        {options.map((option, i) => {
          const checked = option === value
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(option)}
              onKeyDown={onKeyDown}
              className={cn(
                "min-h-9 rounded-[7px] px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                checked ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {labels[option]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
