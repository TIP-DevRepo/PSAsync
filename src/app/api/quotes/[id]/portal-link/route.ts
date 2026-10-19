import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote, quoteWhere } from "@/lib/scoped-loaders"
import { clientLinkOpens } from "@/lib/portal-access"

// The customer link for one quote version, asked for when a user copies it
// or opens the Send Quote dialog, so the client token is never part of the
// quote list or detail responses. opens says whether the customer can use
// it right now: a version that hasn't been sent (or was moved back to
// draft) only opens once it is sent.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: ["quotes.edit", "quotes.sendEmail"],
    message: "You do not have permission to share quote links",
  })
  if (response) return response

  const { id } = await params
  const viewable = await loadViewableQuote(ctx, id)
  if (!viewable) return notFound()

  const quote = await prisma.quote.findUnique({
    where: quoteWhere(ctx, viewable.id),
    select: { accessToken: true, status: true, sentAt: true },
  })
  if (!quote) return notFound()

  return NextResponse.json({
    url: `${req.nextUrl.origin}/portal/${quote.accessToken}`,
    opens: clientLinkOpens(quote),
  })
}
