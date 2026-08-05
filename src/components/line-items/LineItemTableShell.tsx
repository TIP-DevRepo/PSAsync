"use client"

import type { ReactNode } from "react"
import { Pencil, Check, Copy } from "lucide-react"
import { toast } from "@/lib/toast"

export function money(n: number) {
  return `$${n.toFixed(2)}`
}

// Small inline "value + copy button" pairing — copies straight to the
// clipboard so you don't have to open a row for editing just to grab a
// value like a part number or vendor SKU.
export function CopyableCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span className="truncate">{value}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value)
          toast.success("Copied")
        }}
        title="Copy"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Copy size={11} />
      </button>
    </span>
  )
}

export interface ColumnDef {
  header: string
  widthPct: number
  align?: "right" | "center"
}

// Locked, percentage-based columns shared by every line item table in the
// app (Sales Orders, Purchase Orders). Fixed proportions mean the table
// never reflows or squishes when a row switches between read and edit
// mode — switching modes changes cell CONTENT, never cell WIDTH.
export function LineItemTable({
  columns,
  children,
}: {
  columns: ColumnDef[]
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
      <table className="w-full text-sm border-collapse table-fixed">
        <colgroup>
          {columns.map((c, i) => (
            <col key={i} style={{ width: `${c.widthPct}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`py-2 pr-2 ${i === 0 ? "pl-4" : ""} ${c.align === "right" ? "text-right" : ""} ${c.align === "center" ? "text-center" : ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// Up/down reorder buttons — every line item list in the app uses simple
// up/down arrows rather than drag-and-drop (the Quote builder is the one
// exception with its own dedicated dnd-kit implementation, since its
// structure — sections, bundles, choice groups — is meaningfully more
// complex than SO/PO line items).
export function MoveButtons({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <button onClick={onUp} className="text-xs text-muted-foreground hover:text-foreground">▲</button>
      <button onClick={onDown} className="text-xs text-muted-foreground hover:text-foreground">▼</button>
    </div>
  )
}

// The 3-button set shown in read mode: edit (pencil), duplicate, delete.
export function RowActionsRead({
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onEdit} title="Edit" className="text-muted-foreground hover:text-foreground">
        <Pencil size={13} />
      </button>
      <button onClick={onDuplicate} title="Duplicate" className="text-xs text-muted-foreground hover:text-foreground">⧉</button>
      <button onClick={onDelete} title="Delete" className="text-xs text-danger hover:underline">✕</button>
    </div>
  )
}

// The button set shown in edit mode: done (check), duplicate, delete.
export function RowActionsEdit({
  onDone,
  onDuplicate,
  onDelete,
}: {
  onDone: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onDone} title="Done" className="text-success hover:opacity-80">
        <Check size={15} />
      </button>
      <button onClick={onDuplicate} title="Duplicate" className="text-xs text-muted-foreground hover:text-foreground">⧉</button>
      <button onClick={onDelete} title="Delete" className="text-xs text-danger hover:underline">✕</button>
    </div>
  )
}