import type { Prisma } from "@/generated/prisma"
import { notifiesAssignee, ticketAssignedMessage, ticketHref } from "@/lib/ticket-view"

// The in-app notification (the bell, the Notification model) a ticket's new
// assignee gets, written inside the transaction that assigns it, so an
// assignment and its notification never part. Every assignment path calls
// it: a new ticket created for someone (createTicket), round robin, the
// PATCH, and the audit log's undo (both through applyTicketUpdate). Nothing
// is sent when the ticket is unassigned, stays with the same person, or the
// assignee is the person making the change (actorId; for round robin, the
// ticket's creator). No email in this branch.
export async function notifyTicketAssignee(
  tx: Pick<Prisma.TransactionClient, "user" | "notification">,
  input: {
    companyId: string
    ticket: { id: string; number: string; title: string }
    from: string | null
    to: string | null
    actorId: string | null
    roundRobin?: boolean
  }
): Promise<boolean> {
  const { to } = input
  if (!to || !notifiesAssignee({ from: input.from, to, actorId: input.actorId })) return false
  const actor = !input.roundRobin && input.actorId ? await tx.user.findUnique({ where: { id: input.actorId }, select: { name: true } }) : null
  await tx.notification.create({
    data: {
      companyId: input.companyId,
      userId: to,
      type: "TICKET_ASSIGNED",
      message: ticketAssignedMessage(input.ticket, { name: actor?.name ?? null, roundRobin: input.roundRobin }),
      link: ticketHref(input.ticket.id),
    },
    select: { id: true },
  })
  return true
}
