import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadClient, ticketListWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { ticketListSelect } from "@/lib/ticket-selects"
import { pageCount, pageWindow, readPageNumber, ticketListOrderBy, TICKET_PAGE_SIZE } from "@/lib/ticket-list"
import { CLIENT_TICKET_FILTERS, clientTicketCategories, isClientTicketFilter } from "@/lib/ticket-view"
import type { Prisma } from "@/generated/prisma"

// The client page's Tickets tab: one page of this client's tickets the
// user may open (ticketListWhere, the same visibility as the Tickets list;
// never deleted ones), newest first. ?status= is open (Open and Waiting,
// the default), closed (Resolved and Closed), or all; ?page= pages them
// TICKET_PAGE_SIZE at a time. A client of another company, or one that
// doesn't exist, is a 404.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, response } = await requireAccess({
    permission: "pages.tickets",
    message: "You do not have permission to view tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const client = await loadClient(ctx, id)
  if (!client) return notFound()

  const search = req.nextUrl.searchParams
  const status = search.get("status") || CLIENT_TICKET_FILTERS[0]
  if (!isClientTicketFilter(status)) return apiError(400, "Invalid status filter")
  const page = readPageNumber(search.get("page"))
  if (page === null) return apiError(400, "Invalid page")

  const categories = clientTicketCategories(status)
  const where: Prisma.TicketWhereInput = {
    AND: [ticketListWhere(ctx), { clientId: client.id }, ...(categories ? [{ status: { category: { in: [...categories] } } }] : [])],
  }
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, select: ticketListSelect, orderBy: ticketListOrderBy("", "asc"), ...pageWindow(page) }),
    prisma.ticket.count({ where }),
  ])
  return NextResponse.json({ tickets, total, page, pageSize: TICKET_PAGE_SIZE, pageCount: pageCount(total) })
}
