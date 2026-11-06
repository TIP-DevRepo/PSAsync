import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableTicket, ticketWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { ownSenderOptions } from "@/lib/quote-sender"
import { EMAIL_ATTACHMENTS_MAX_BYTES } from "@/lib/microsoft-mail"

// What the Email action's composer needs on a ticket, the same shape as the
// opportunity email options: the From choices and default, the company
// signature, the attachment size limit, and the ticket client's contacts
// that have an email address (none for a ticket with no client). Never
// returns tokens or credentials.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.edit",
    message: "You do not have permission to edit tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = await loadViewableTicket(ctx, id)
  if (!ticket) return notFound()

  // Outside any transaction, so these run in parallel
  const [sender, settings, record] = await Promise.all([
    ownSenderOptions(ctx),
    prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { emailSignature: true } }),
    prisma.ticket.findFirst({
      where: ticketWhere(ctx, ticket.id),
      select: {
        client: {
          select: {
            contacts: {
              where: { email: { not: null } },
              select: { id: true, firstName: true, lastName: true, email: true },
              orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            },
          },
        },
      },
    }),
  ])

  return NextResponse.json({
    ...sender,
    signature: settings?.emailSignature?.trim() || null,
    maxAttachmentBytes: EMAIL_ATTACHMENTS_MAX_BYTES,
    contacts: (record?.client?.contacts ?? [])
      .filter((c) => !!c.email)
      .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email as string })),
  })
}
