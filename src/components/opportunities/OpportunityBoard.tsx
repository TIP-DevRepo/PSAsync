"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { GripVertical } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { cn } from "@/lib/utils"
import {
  boardColumns,
  CLOSED_COLUMN_DAYS,
  formatCents,
  formatDateOnly,
  valueCents,
  type BoardColumn,
  type OpportunityRow,
  type StageOption,
} from "@/lib/opportunity-view"
import { CategoryPill } from "./StagePill"

// The pointer picks the column under it; the keyboard (no pointer) falls
// back to the column the card overlaps most
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

// Left and Right jump the picked up card to the next column's center line
// instead of nudging it a few pixels. Up and Down do nothing (a column has
// no order to keep). Space or Enter drops it, Escape puts it back.
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return undefined
  event.preventDefault()
  const { collisionRect, droppableRects, droppableContainers } = context
  if (!collisionRect) return undefined
  const columns = droppableContainers
    .getEnabled()
    .map((container) => droppableRects.get(container.id))
    .filter((rect): rect is NonNullable<typeof rect> => !!rect)
    .sort((a, b) => a.left - b.left)
  const center = collisionRect.left + collisionRect.width / 2
  const target =
    event.code === "ArrowRight"
      ? columns.find((rect) => rect.left > center)
      : [...columns].reverse().find((rect) => rect.left + rect.width < center)
  if (!target) return undefined
  return { x: target.left + (target.width - collisionRect.width) / 2, y: currentCoordinates.y }
}

export function OpportunityBoard({
  stages,
  opportunities,
  canEdit,
  onMove,
  listHref,
}: {
  stages: StageOption[]
  opportunities: OpportunityRow[]
  canEdit: boolean
  onMove: (card: OpportunityRow, stage: StageOption) => void
  // The list filtered to one stage, for a Won or Lost column's older cards
  listHref: (stageId: string) => string
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // A drag that ends over the card it started on would otherwise also
  // count as a click and open the opportunity
  const draggedRecently = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates })
  )

  const columns = useMemo(() => boardColumns(stages, opportunities, new Date()), [stages, opportunities])
  const activeCard = activeId ? opportunities.find((o) => o.id === activeId) ?? null : null

  const cardLabel = (id: UniqueIdentifier) => opportunities.find((o) => o.id === String(id))?.title ?? "opportunity"
  const stageLabel = (id: UniqueIdentifier) => stages.find((s) => s.id === String(id))?.name ?? "a stage"
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${cardLabel(active.id)}. Use the left and right arrows to choose a stage.`,
    onDragOver: ({ active, over }) => (over ? `${cardLabel(active.id)} is over ${stageLabel(over.id)}.` : `${cardLabel(active.id)} is not over a stage.`),
    onDragEnd: ({ active, over }) => (over ? `${cardLabel(active.id)} was moved to ${stageLabel(over.id)}.` : `${cardLabel(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${cardLabel(active.id)} was cancelled.`,
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    draggedRecently.current = true
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    setTimeout(() => (draggedRecently.current = false), 0)
    const card = opportunities.find((o) => o.id === String(event.active.id))
    const stage = event.over ? stages.find((s) => s.id === String(event.over!.id)) : undefined
    if (card && stage && card.stage.id !== stage.id) onMove(card, stage)
  }

  return (
    <DndContext
      id="opportunity-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setTimeout(() => (draggedRecently.current = false), 0)
      }}
      accessibility={{ announcements }}
    >
      {/* Columns keep their width; the board scrolls sideways instead of squeezing them */}
      <div className="-mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex w-max gap-4">
          {columns.map((column) => (
            <StageColumn
              key={column.stage.id}
              column={column}
              canEdit={canEdit}
              dragging={activeId !== null}
              activeId={activeId}
              draggedRecently={draggedRecently}
              listHref={listHref(column.stage.id)}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeCard ? (
          <div className="rotate-2 scale-[1.03] cursor-grabbing rounded-lg shadow-popover">
            <CardBody card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function StageColumn({
  column,
  canEdit,
  dragging,
  activeId,
  draggedRecently,
  listHref,
}: {
  column: BoardColumn
  canEdit: boolean
  dragging: boolean
  activeId: string | null
  draggedRecently: React.RefObject<boolean>
  listHref: string
}) {
  const { stage, cards, count, totalCents, olderCount } = column
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canEdit })
  const headingId = `opportunity-column-${stage.id}`

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-muted/40 transition-colors duration-150",
        isOver ? "border-primary bg-primary/5 ring-2 ring-primary/40" : dragging ? "border-dashed border-primary/40" : "border-border"
      )}
    >
      <header className="space-y-1 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="truncate text-sm font-semibold text-foreground" title={stage.name}>
            {stage.name}
          </h2>
          <CategoryPill category={stage.category} />
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {count} {count === 1 ? "opportunity" : "opportunities"} · {formatCents(totalCents)}
        </p>
      </header>

      <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
        {cards.map((card) => (
          <BoardCard key={card.id} card={card} canEdit={canEdit} hidden={card.id === activeId} draggedRecently={draggedRecently} />
        ))}
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {stage.category === "OPEN" ? "Nothing in this stage" : `Nothing closed in the last ${CLOSED_COLUMN_DAYS} days`}
          </p>
        )}
      </div>

      {olderCount > 0 && (
        <Link
          href={listHref}
          className="border-t border-border px-3 py-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {olderCount} older, view in list
        </Link>
      )}
    </section>
  )
}

function BoardCard({
  card,
  canEdit,
  hidden,
  draggedRecently,
}: {
  card: OpportunityRow
  canEdit: boolean
  hidden: boolean
  draggedRecently: React.RefObject<boolean>
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: card.id, disabled: !canEdit })

  return (
    <div
      ref={setNodeRef}
      // The pointer can pick up the whole card; the keyboard uses the handle
      {...(canEdit ? listeners : {})}
      onClickCapture={(e) => {
        if (draggedRecently.current) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      className={cn("group relative", hidden && "opacity-40", canEdit && "cursor-grab active:cursor-grabbing")}
    >
      <CardBody card={card} link />
      {canEdit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          aria-label={`Move ${card.number} ${card.title} to another stage`}
          className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-surface-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function CardBody({ card, link = false }: { card: OpportunityRow; link?: boolean }) {
  // Value is expectedValue for now. Branch 3 switches it to the latest quote total.
  const value = card.expectedValue === null ? "-" : formatCents(valueCents(card.expectedValue))
  return (
    <article className="space-y-1.5 rounded-lg border border-border bg-card p-3 pr-9 text-sm shadow-card transition-shadow duration-200 ease-out hover:shadow-elevated">
      <p className="text-xs font-medium tabular-nums text-muted-foreground">{card.number}</p>
      {link ? (
        <Link
          href={`/dashboard/opportunities/${card.id}`}
          draggable={false}
          className="block font-semibold leading-snug text-foreground after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          <span className="line-clamp-2 break-words">{card.title}</span>
        </Link>
      ) : (
        <p className="line-clamp-2 break-words font-semibold leading-snug text-foreground">{card.title}</p>
      )}
      <p className="truncate text-muted-foreground" title={card.client.name}>
        {card.client.name}
      </p>
      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <span className="truncate text-muted-foreground" title={card.owner?.name ?? "Unassigned"}>
          {card.owner?.name ?? "Unassigned"}
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <p className="text-xs text-muted-foreground">Close {formatDateOnly(card.expectedCloseDate)}</p>
    </article>
  )
}
