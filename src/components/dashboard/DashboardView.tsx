"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Copy, ChevronDown, Pencil, Check, Star, Trash2 } from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { DashboardWidgetTile } from "./DashboardWidgetTile"
import { GridCell } from "./GridCell"
import { AddWidgetPanel } from "./AddWidgetPanel"
import { NewDashboardModal } from "./NewDashboardModal"
import { WidgetSkeleton } from "./WidgetSkeleton"
import { GlobalSpotlight } from "./GlobalSpotlight"
import { GRID_COLUMNS, GRID_ROWS, type WidgetType, type WidgetSize } from "@/lib/dashboards/widgetTypes"
import { occupiedCells, canPlace } from "@/lib/dashboards/gridPlacement"

interface DashboardListItem {
  id: string
  name: string
  isDefault: boolean
  userId: string | null
  isMyDefault: boolean
}

interface WidgetRow {
  id: string
  widgetType: WidgetType
  size: WidgetSize
  row: number
  col: number
}

interface DashboardDetail extends DashboardListItem {
  widgets: WidgetRow[]
  canEdit: boolean
}

function parseCellId(id: string): { row: number; col: number } | null {
  const match = /^cell-(\d+)-(\d+)$/.exec(id)
  if (!match) return null
  return { row: Number(match[1]), col: Number(match[2]) }
}

export function DashboardView({ allowedWidgetTypes }: { allowedWidgetTypes: WidgetType[] }) {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DashboardDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(true)
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [showNewDashboard, setShowNewDashboard] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null)
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const loadDashboards = useCallback(() => {
    fetch("/api/dashboards")
      .then((res) => res.json())
      .then((data: DashboardListItem[]) => {
        setDashboards(data)
        setLoadingList(false)
        setSelectedId(
          (prev) => prev ?? data.find((d) => d.isMyDefault)?.id ?? data.find((d) => d.isDefault)?.id ?? data[0]?.id ?? null
        )
      })
  }, [])

  const loadDetail = useCallback((id: string) => {
    setLoadingDetail(true)
    fetch(`/api/dashboards/${id}`)
      .then((res) => res.json())
      .then((data: DashboardDetail) => {
        setDetail(data)
        setLoadingDetail(false)
      })
  }, [])

  useEffect(() => {
    loadDashboards()
  }, [loadDashboards])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    setEditMode(false)
  }, [selectedId, loadDetail])

  async function handleAddWidget(widgetType: WidgetType, size: WidgetSize) {
    if (!detail) return
    const res = await fetch(`/api/dashboards/${detail.id}/widgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetType, size }),
    })
    setShowAddWidget(false)
    if (res.ok) {
      loadDetail(detail.id)
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't add widget")
    }
  }

  async function handleRemoveWidget(widgetId: string) {
    if (!detail) return
    await fetch(`/api/dashboards/${detail.id}/widgets/${widgetId}`, { method: "DELETE" })
    loadDetail(detail.id)
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingWidgetId(String(event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    setHoverCell(event.over ? parseCellId(String(event.over.id)) : null)
  }

  function handleDragCancel() {
    setDraggingWidgetId(null)
    setHoverCell(null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const widgetId = String(event.active.id)
    const cell = event.over ? parseCellId(String(event.over.id)) : null
    setDraggingWidgetId(null)
    setHoverCell(null)
    if (!detail || !cell) return

    const widget = detail.widgets.find((w) => w.id === widgetId)
    if (!widget) return
    if (widget.row === cell.row && widget.col === cell.col) return

    const others = detail.widgets.filter((w) => w.id !== widgetId)
    if (!canPlace(cell.row, cell.col, widget.size, others)) {
      toast.error("That spot doesn't fit — it's off the grid or overlaps another widget")
      return
    }

    setDetail({
      ...detail,
      widgets: detail.widgets.map((w) => (w.id === widgetId ? { ...w, row: cell.row, col: cell.col } : w)),
    })
    await fetch(`/api/dashboards/${detail.id}/widgets/${widgetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: cell.row, col: cell.col }),
    })
  }

  async function handleCreateDashboard(name: string) {
    const res = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    setShowNewDashboard(false)
    if (res.ok) {
      const created = await res.json()
      toast.success(`Dashboard "${name}" created`)
      setDashboards((prev) => [
        ...prev,
        { id: created.id, name: created.name, isDefault: false, userId: created.userId, isMyDefault: false },
      ])
      setSelectedId(created.id)
    } else {
      toast.error("Couldn't create dashboard")
    }
  }

  async function handleSetMyDefault(dashboardId: string) {
    const res = await fetch(`/api/dashboards/${dashboardId}/set-default`, { method: "POST" })
    if (res.ok) {
      setDashboards((prev) => prev.map((d) => ({ ...d, isMyDefault: d.id === dashboardId })))
      toast.success("Default dashboard updated")
    } else {
      toast.error("Couldn't update your default dashboard")
    }
  }

  async function handleDeleteDashboard(dashboardId: string, name: string) {
    const confirmed = await confirmDialog({
      title: `Delete "${name}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return

    const res = await fetch(`/api/dashboards/${dashboardId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(`Dashboard "${name}" deleted`)
      setDashboards((prev) => prev.filter((d) => d.id !== dashboardId))
      if (dashboardId === selectedId) setSelectedId(null)
      loadDashboards()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't delete dashboard")
    }
  }

  async function handleClone() {
    if (!detail) return
    const res = await fetch(`/api/dashboards/${detail.id}/clone`, { method: "POST" })
    if (res.ok) {
      const clone = await res.json()
      toast.success(`Cloned to "${clone.name}"`)
      loadDashboards()
      setSelectedId(clone.id)
    } else {
      toast.error("Couldn't clone dashboard")
    }
  }

  if (loadingList) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  const widgets = detail?.widgets ?? []
  const draggingWidget = draggingWidgetId ? widgets.find((w) => w.id === draggingWidgetId) : null
  const othersWhileDragging = draggingWidget ? widgets.filter((w) => w.id !== draggingWidget.id) : []
  const hoverFootprint =
    draggingWidget && hoverCell ? new Set(occupiedCells(hoverCell.row, hoverCell.col, draggingWidget.size)) : null
  const hoverValid =
    draggingWidget && hoverCell ? canPlace(hoverCell.row, hoverCell.col, draggingWidget.size, othersWhileDragging) : false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-hover"
          >
            {detail?.name ?? "Loading..."}
            <ChevronDown size={14} />
          </button>
          {switcherOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card py-1 shadow-elevated">
              {dashboards.map((d) => (
                <div key={d.id} className="group flex items-center">
                  <button
                    onClick={() => {
                      setSelectedId(d.id)
                      setSwitcherOpen(false)
                    }}
                    className={`flex-1 truncate px-3 py-2 text-left text-sm hover:bg-surface-hover ${
                      d.id === selectedId ? "font-semibold text-primary" : "text-foreground"
                    }`}
                  >
                    {d.name}
                    {d.isDefault ? " (Default)" : ""}
                  </button>
                  <button
                    onClick={() => handleSetMyDefault(d.id)}
                    title={d.isMyDefault ? "Your default dashboard" : "Set as my default"}
                    className={`shrink-0 p-1.5 ${
                      d.isMyDefault ? "text-warning" : "text-muted-foreground opacity-0 group-hover:opacity-100"
                    } hover:text-warning`}
                  >
                    <Star size={14} fill={d.isMyDefault ? "currentColor" : "none"} />
                  </button>
                  {!d.isDefault && (
                    <button
                      onClick={() => handleDeleteDashboard(d.id, d.name)}
                      title="Delete dashboard"
                      className="mr-1 shrink-0 p-1.5 text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  setShowNewDashboard(true)
                  setSwitcherOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface-hover"
              >
                <Plus size={14} /> New Dashboard
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {detail && !detail.canEdit && (
            <Button size="sm" variant="outline" onClick={handleClone}>
              <Copy size={14} /> Clone to my dashboards
            </Button>
          )}
          {detail?.canEdit && (
            <>
              <Button size="sm" variant={editMode ? "default" : "outline"} onClick={() => setEditMode((v) => !v)}>
                {editMode ? <Check size={14} /> : <Pencil size={14} />}
                {editMode ? "Done" : "Edit"}
              </Button>
              <Button size="sm" onClick={() => setShowAddWidget(true)}>
                <Plus size={14} /> Add Widget
              </Button>
            </>
          )}
        </div>
      </div>

      {loadingDetail ? (
        <div className="grid grid-cols-4 auto-rows-[160px] gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="col-span-1 row-span-1 rounded-xl border border-border bg-card p-5 shadow-card">
              <WidgetSkeleton />
            </div>
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="font-medium text-foreground">No widgets yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail?.canEdit ? "Add a widget to get started." : "This dashboard has no widgets yet."}
          </p>
        </div>
      ) : (
        <>
          <GlobalSpotlight gridRef={gridRef} />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div ref={gridRef} className="bento-section grid grid-cols-4 auto-rows-[160px] gap-4">
              {editMode &&
                Array.from({ length: GRID_ROWS }, (_, row) =>
                  Array.from({ length: GRID_COLUMNS }, (_, col) => {
                    const key = `${row}-${col}`
                    return (
                      <GridCell
                        key={key}
                        row={row}
                        col={col}
                        covered={!!hoverFootprint?.has(key)}
                        valid={hoverValid}
                      />
                    )
                  })
                )}
              {widgets.map((w) => (
                <DashboardWidgetTile
                  key={w.id}
                  id={w.id}
                  widgetType={w.widgetType}
                  size={w.size}
                  row={w.row}
                  col={w.col}
                  editMode={editMode}
                  editable={!!detail?.canEdit}
                  onRemove={handleRemoveWidget}
                />
              ))}
            </div>
          </DndContext>
        </>
      )}

      <AddWidgetPanel
        open={showAddWidget}
        allowedTypes={allowedWidgetTypes}
        existingWidgets={widgets}
        onClose={() => setShowAddWidget(false)}
        onAdd={handleAddWidget}
      />
      {showNewDashboard && <NewDashboardModal onClose={() => setShowNewDashboard(false)} onCreate={handleCreateDashboard} />}
    </div>
  )
}
