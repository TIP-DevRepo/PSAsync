"use client"

import type { ReactNode, CSSProperties } from "react"
import { X, GripVertical } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { BentoTile } from "./BentoTile"
import { StatTrendWidget } from "./StatTrendWidget"
import { GroupedCountWidget } from "./GroupedCountWidget"
import { SIZE_DIMENSIONS } from "@/lib/dashboards/gridPlacement"
import { WIDGET_LABELS, type WidgetType, type WidgetSize } from "@/lib/dashboards/widgetTypes"

const WIDGET_HREF: Partial<Record<WidgetType, string>> = {
  OPEN_QUOTES: "/dashboard/quotes",
  OPEN_POS: "/dashboard/purchase-orders",
  TOTAL_CLIENTS: "/dashboard/clients",
}

export function DashboardWidgetTile({
  id,
  widgetType,
  size,
  row,
  col,
  // editMode is the user's toggle; editable is whether they're actually
  // allowed to edit this dashboard at all (permission-gated). Dragging
  // and the remove button both require both to be true.
  editMode,
  editable,
  onRemove,
}: {
  id: string
  widgetType: WidgetType
  size: WidgetSize
  row: number
  col: number
  editMode: boolean
  editable: boolean
  onRemove: (id: string) => void
}) {
  const canDrag = editMode && editable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: !canDrag })

  const label = WIDGET_LABELS[widgetType]
  const href = WIDGET_HREF[widgetType]

  let content: ReactNode
  switch (widgetType) {
    case "OPEN_QUOTES":
    case "OPEN_POS":
    case "TOTAL_CLIENTS":
      content = <StatTrendWidget type={widgetType} label={label} />
      break
    case "INVENTORY_BY_STATUS":
      content = <GroupedCountWidget type={widgetType} label={label} linkParam="status" />
      break
    case "INVENTORY_BY_CLIENT":
      content = <GroupedCountWidget type={widgetType} label={label} linkParam="owner" />
      break
  }

  const { w, h } = SIZE_DIMENSIONS[size]

  const style: CSSProperties = {
    gridColumn: `${col + 1} / span ${w}`,
    gridRow: `${row + 1} / span ${h}`,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 10,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      <BentoTile href={!editMode ? href : undefined}>{content}</BentoTile>

      {canDrag && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100">
          <GripVertical size={14} />
        </div>
      )}

      {editMode && editable && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove(id)
          }}
          title="Remove widget"
          className="absolute right-2 top-2 z-10 rounded-md bg-background/80 p-1 text-muted-foreground hover:text-danger"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
