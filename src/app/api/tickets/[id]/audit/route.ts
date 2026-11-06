import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableTicketIncludingDeletedWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { auditListResponse } from "@/lib/audit-records"

// One ticket's audit log, the same shape, paging, and filters as GET
// /api/audit-log. Needs auditLog.view and the ticket view check, with
// deleted tickets included (the audit log is where they can be restored).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.view",
    message: "You do not have permission to view the audit log",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = ctx.can("pages.tickets")
    ? await prisma.ticket.findFirst({ where: viewableTicketIncludingDeletedWhere(ctx, id), select: { id: true } })
    : null
  if (!ticket) return notFound()

  return auditListResponse(ctx, req.nextUrl.searchParams, { recordType: "TICKET", recordId: ticket.id }, { withRecordTypes: false })
}
