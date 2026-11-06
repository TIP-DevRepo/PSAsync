import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { viewableTicketIncludingDeletedWhere } from "@/lib/scoped-loaders"
import type { AuditEntryRow } from "@/lib/audit-log"
import { applyTicketUpdate, planTicketUpdate, ticketUpdateExistingSelect, type SavedTicket, type TicketUpdateExisting } from "@/lib/ticket-update"
import { ticketFieldAudits, ticketUndoneAudit } from "@/lib/ticket-audit"
import { undoRecordChange, type UndoAdapter, type UndoResult } from "@/lib/record-undo"

// Undoing one field_changed entry of a ticket from the audit log, through
// the shared undo (undoRecordChange, the same flow opportunities use). The
// before value goes back through the ticket PATCH rules (planTicketUpdate),
// so the assignee must be in the team, the contact and location must
// belong to the client, a status move sets resolvedAt and closedAt as
// usual, and the user must be able to open the ticket. A client with its
// contact and location, and a team with its assignee, are undone together.

export const TICKET_UNDO_NO_ACCESS_MESSAGE = "This ticket can't be found, or you don't have access to it"

const ticketUndo: UndoAdapter<TicketUpdateExisting, SavedTicket> = {
  loadExisting: (ctx, recordId) => {
    if (!ctx.can("pages.tickets")) return Promise.resolve(null)
    return prisma.ticket.findFirst({
      where: viewableTicketIncludingDeletedWhere(ctx, recordId),
      select: { ...ticketUpdateExistingSelect, deletedAt: true },
    })
  },
  plan: planTicketUpdate,
  apply: (tx, ctx, recordId, data, auditEntries) => applyTicketUpdate(tx, ctx, recordId, data, auditEntries),
  fieldAudits: ticketFieldAudits,
  undoneAudit: ticketUndoneAudit,
  noAccessMessage: TICKET_UNDO_NO_ACCESS_MESSAGE,
}

export function undoTicketChange(ctx: AccessContext, entry: AuditEntryRow): Promise<UndoResult<SavedTicket>> {
  return undoRecordChange(ctx, entry, ticketUndo)
}
