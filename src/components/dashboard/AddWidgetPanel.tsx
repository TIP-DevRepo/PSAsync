"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { WIDGET_LABELS, GRID_TOTAL_CELLS, type WidgetType, type WidgetSize } from "@/lib/dashboards/widgetTypes"
import { findFirstAvailableCell, type PlacedWidget } from "@/lib/dashboards/gridPlacement"

const SIZE_OPTIONS: { size: WidgetSize; label: string; filled: boolean[] }[] = [
  { size: "SMALL", label: "Small (1 square)", filled: [true, false, false, false] },
  { size: "MEDIUM", label: "Medium (2 squares)", filled: [true, true, false, false] },
  { size: "LARGE", label: "Large (4 squares)", filled: [true, true, true, true] },
]

function SizePreview({ filled }: { filled: boolean[] }) {
  return (
    <div className="grid h-8 w-8 shrink-0 grid-cols-2 gap-0.5">
      {filled.map((f, i) => (
        <div key={i} className={`rounded-[3px] ${f ? "bg-primary" : "bg-muted"}`} />
      ))}
    </div>
  )
}

export function AddWidgetPanel({
  open,
  allowedTypes,
  existingWidgets,
  onClose,
  onAdd,
}: {
  open: boolean
  // Already filtered down to widget types this user has permission to
  // view, so the picker never offers something they can't actually see.
  allowedTypes: WidgetType[]
  // Current widgets on the dashboard — used to check whether each size
  // actually has a free spot on the grid, not just a cell-count budget.
  existingWidgets: PlacedWidget[]
  onClose: () => void
  onAdd: (widgetType: WidgetType, size: WidgetSize) => void
}) {
  const [selectedType, setSelectedType] = useState<WidgetType | "">("")
  const [selectedSize, setSelectedSize] = useState<WidgetSize>("SMALL")

  const usedCells = existingWidgets.length
  const fits: Record<WidgetSize, boolean> = {
    SMALL: !!findFirstAvailableCell("SMALL", existingWidgets),
    MEDIUM: !!findFirstAvailableCell("MEDIUM", existingWidgets),
    LARGE: !!findFirstAvailableCell("LARGE", existingWidgets),
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Add Widget</SheetTitle>
          <SheetDescription>{GRID_TOTAL_CELLS - usedCells} of {GRID_TOTAL_CELLS} grid squares free.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Widget</p>
            <div className="space-y-1.5">
              {allowedTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selectedType === t
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : "border-border text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {WIDGET_LABELS[t]}
                </button>
              ))}
              {allowedTypes.length === 0 && (
                <p className="text-xs text-muted-foreground">You don't have permission to view any available widget types.</p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Size</p>
            <div className="space-y-1.5">
              {SIZE_OPTIONS.map(({ size, label, filled }) => {
                const disabled = !fits[size]
                return (
                  <button
                    key={size}
                    disabled={disabled}
                    onClick={() => setSelectedSize(size)}
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      selectedSize === size && !disabled
                        ? "border-primary bg-primary/5 font-medium text-primary"
                        : "border-border text-foreground hover:bg-surface-hover"
                    }`}
                  >
                    <SizePreview filled={filled} />
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selectedType || !fits[selectedSize]}
            onClick={() => selectedType && onAdd(selectedType, selectedSize)}
          >
            Add Widget
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
