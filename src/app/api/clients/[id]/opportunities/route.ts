import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadClient, opportunityListWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { opportunityListSelect } from "@/lib/opportunity-selects"
import { withQuoteValues } from "@/lib/opportunity-quotes"
import { readPageNumber } from "@/lib/ticket-list"
import { CLIENT_OPPORTUNITY_FILTERS, CLIENT_OPPORTUNITY_PAGE_SIZE, clientOpportunityCategory, isClientOpportunityFilter } from "@/lib/opportunity-view"
import type { Prisma } from "@/generated/prisma"

// The client page's Opportunities tab: one page of this client's
// opportunities the user may open (opportunityListWhere, the same team
// visibility as the Opportunities list; never deleted ones), newest first.
// ?status= is open (an OPEN stage, the default), won, lost, or all; ?page=
// pages them CLIENT_OPPORTUNITY_PAGE_SIZE at a time. Each row carries
// quoteValue like the list. A client of another company, or one that
// doesn't exist, is a 404.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const client = await loadClient(ctx, id)
  if (!client) return notFound()

  const search = req.nextUrl.searchParams
  const status = search.get("status") || CLIENT_OPPORTUNITY_FILTERS[0]
  if (!isClientOpportunityFilter(status)) return apiError(400, "Invalid status filter")
  const page = readPageNumber(search.get("page"))
  if (page === null) return apiError(400, "Invalid page")

  const category = clientOpportunityCategory(status)
  const where: Prisma.OpportunityWhereInput = {
    AND: [opportunityListWhere(ctx), { clientId: client.id }, ...(category ? [{ stage: { category } }] : [])],
  }
  const [opportunities, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      select: opportunityListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * CLIENT_OPPORTUNITY_PAGE_SIZE,
      take: CLIENT_OPPORTUNITY_PAGE_SIZE,
    }),
    prisma.opportunity.count({ where }),
  ])
  return NextResponse.json({
    opportunities: await withQuoteValues(ctx.companyId, opportunities),
    total,
    page,
    pageSize: CLIENT_OPPORTUNITY_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / CLIENT_OPPORTUNITY_PAGE_SIZE)),
  })
}
