import { PriorityMarker, StatusPill } from "@/components/ui/blocks"
import { TICKET_CATEGORY_LABELS } from "@/lib/ticket-rules"
import { priorityToneByOrder, statusTone } from "@/lib/ticket-view"
import type { TicketStatusCategory } from "@/generated/prisma"

// Plain markup (no client hooks), so server and client components can both
// use them. A status is tinted by its category, a priority by its place in
// the company's order (src/lib/ticket-view.ts), never by their names.

export function TicketStatusPill({ name, category, className }: { name: string; category: TicketStatusCategory; className?: string }) {
  return (
    <StatusPill tone={statusTone(category)} title={`${name} (${TICKET_CATEGORY_LABELS[category]})`} className={className}>
      <span className="truncate">{name}</span>
    </StatusPill>
  )
}

// allOrders: every priority's sortOrder (GET /api/ticket-priorities)
export function TicketPriorityMarker({ name, sortOrder, allOrders }: { name: string; sortOrder: number; allOrders: readonly number[] }) {
  return <PriorityMarker tone={priorityToneByOrder(sortOrder, allOrders)}>{name}</PriorityMarker>
}

// A priority as a tinted pill, for the record header
export function TicketPriorityPill({ name, sortOrder, allOrders }: { name: string; sortOrder: number; allOrders: readonly number[] }) {
  return (
    <StatusPill tone={priorityToneByOrder(sortOrder, allOrders)} title={`Priority: ${name}`}>
      <span className="truncate">{name}</span>
    </StatusPill>
  )
}
