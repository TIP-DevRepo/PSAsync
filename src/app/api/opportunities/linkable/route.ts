import { NextRequest, NextResponse } from "next/server"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { loadLinkableOpportunities } from "@/lib/opportunity-quotes"

// The Opportunity picker on the quote, sales order, and purchase order
// forms: the opportunities the user may open (never deleted ones) that the
// record may link to. for=quote lists OPEN ones of clientId and contactId
// (both needed, else none); for=order lists any stage, of clientId when it
// is given. Each with its number, title, stage, and team. The routes that
// save a link check the same rule again (assertRefs quoteOpportunityId and
// orderOpportunityId).
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const params = req.nextUrl.searchParams
  const record = params.get("for")
  if (record !== "quote" && record !== "order") return apiError(400, "Invalid record type")
  const clientId = params.get("clientId") || null
  const contactId = params.get("contactId") || null

  // The contact must be the client's, and both this company's
  const invalid = await assertRefs(ctx, { clientId, contactId })
  if (invalid) return invalid

  return NextResponse.json(await loadLinkableOpportunities(ctx, { record, clientId, contactId }))
}
