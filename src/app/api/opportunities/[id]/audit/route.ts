import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableOpportunityIncludingDeletedWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { auditListResponse } from "@/lib/audit-records"

// One opportunity's audit log (its Audit log tab), the same shape, paging,
// and filters as GET /api/audit-log. Needs auditLog.view and the
// opportunity view check, with deleted opportunities included.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.view",
    message: "You do not have permission to view the audit log",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityIncludingDeletedWhere(ctx, id),
    select: { id: true },
  })
  if (!opportunity) return notFound()

  return auditListResponse(ctx, req.nextUrl.searchParams, { recordType: "OPPORTUNITY", recordId: opportunity.id }, { withRecordTypes: false })
}
