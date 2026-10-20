import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { withoutPortalTokensOrNull, withoutPortalTokens } from "@/lib/portal-token"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"
import { applyTermsFreeze, loadCompanyDefaultTerms, termsFreezeFor } from "@/lib/quote-terms"
import { loadMatchingWorkflows } from "@/lib/approval-workflows"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.changeStatus",
    message: "You do not have permission to change a quote's status",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: { lineItems: true },
  })
  if (!quote) return notFound()
  if (quote.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only draft quotes can be sent. A quote pending approval must be approved first." },
      { status: 400 }
    )
  }

  // ─── Evaluate active approval workflows against this quote ──────────────
  // (src/lib/approval-workflows.ts, the same rule as send-email and status)
  const matched = await loadMatchingWorkflows(companyId, quote)

  if (matched.length > 0) {
    // Needs sign-off — create one pending approval per matched workflow and
    // hold the quote instead of sending it
    await prisma.$transaction([
      ...matched.map((w) =>
        prisma.quoteApproval.upsert({
          where: { quoteId_workflowId: { quoteId: id, workflowId: w.id } },
          update: { status: "PENDING", approvedByUserId: null, decidedAt: null, reason: null },
          create: { quoteId: id, workflowId: w.id, status: "PENDING" },
        })
      ),
      // No email goes with this send, so an email held earlier must not go
      // out once it's approved
      prisma.quote.update({ where: { id }, data: { status: "PENDING_APPROVAL", pendingEmailPayload: Prisma.JsonNull } }),
    ])

    const updated = await prisma.quote.findUnique({ where: { id } })
    return NextResponse.json(withoutPortalTokensOrNull(updated))
  }

  // No approval needed, send immediately. A quote using the company
  // default terms keeps the default as it is now, frozen in this write.
  const freeze = termsFreezeFor(quote, await loadCompanyDefaultTerms(companyId))
  const updated = await prisma.$transaction(async (tx) => {
    await applyTermsFreeze(tx, id, freeze)
    // This version becomes the one clients see; every other version in the
    // same quote family is archived (deactivated) but kept for history
    await tx.quote.updateMany({
      where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
      data: { isActive: false },
    })

    return tx.quote.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), isActive: true, pendingEmailPayload: Prisma.JsonNull },
    })
  })

  return NextResponse.json(withoutPortalTokens(updated))
}