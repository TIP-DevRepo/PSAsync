import { GRID_COLUMNS, GRID_ROWS, type WidgetSize } from "./widgetTypes"

// Width/height in grid cells for each size — Small is a single square,
// Medium a 2-wide domino, Large a 2x2 block.
export const SIZE_DIMENSIONS: Record<WidgetSize, { w: number; h: number }> = {
  SMALL: { w: 1, h: 1 },
  MEDIUM: { w: 2, h: 1 },
  LARGE: { w: 2, h: 2 },
}

export interface PlacedWidget {
  row: number
  col: number
  size: WidgetSize
}

export function occupiedCells(row: number, col: number, size: WidgetSize): string[] {
  const { w, h } = SIZE_DIMENSIONS[size]
  const cells: string[] = []
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push(`${row + dy}-${col + dx}`)
    }
  }
  return cells
}

export function fitsInBounds(row: number, col: number, size: WidgetSize): boolean {
  const { w, h } = SIZE_DIMENSIONS[size]
  return row >= 0 && col >= 0 && row + h <= GRID_ROWS && col + w <= GRID_COLUMNS
}

// `others` should already exclude the widget being placed (if it's an
// existing one being moved) — the caller filters that, this function
// just checks the given footprint against whatever list it's handed.
export function canPlace(row: number, col: number, size: WidgetSize, others: PlacedWidget[]): boolean {
  if (!fitsInBounds(row, col, size)) return false
  const target = new Set(occupiedCells(row, col, size))
  return !others.some((o) => occupiedCells(o.row, o.col, o.size).some((c) => target.has(c)))
}

// Scans the grid in reading order for the first cell a widget of this
// size can legally occupy — used to auto-place a newly added widget.
export function findFirstAvailableCell(size: WidgetSize, others: PlacedWidget[]): { row: number; col: number } | null {
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      if (canPlace(row, col, size, others)) return { row, col }
    }
  }
  return null
}
