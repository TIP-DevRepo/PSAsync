"use client"

import { useDroppable } from "@dnd-kit/core"

export function GridCell({
  row,
  col,
  covered,
  valid,
}: {
  row: number
  col: number
  // Whether this cell falls under the currently-dragged widget's
  // footprint if dropped at the hovered cell, and whether that
  // placement would actually be legal (in bounds, no overlap).
  covered: boolean
  valid: boolean
}) {
  const { setNodeRef } = useDroppable({ id: `cell-${row}-${col}` })
  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: `${col + 1} / span 1`, gridRow: `${row + 1} / span 1` }}
      className={`rounded-lg border border-dashed transition-colors ${
        covered ? (valid ? "border-primary bg-primary/10" : "border-danger bg-danger/10") : "border-border/40"
      }`}
    />
  )
}
