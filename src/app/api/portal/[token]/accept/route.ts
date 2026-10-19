import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { createSalesOrderFromAcceptedQuote } from "@/lib/sales-orders"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { portalQuoteSelect, toPortalQuote } from "@/lib/portal-public"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Only while the quote is waiting on the customer (SENT or VIEWED) and
  // not expired; anything else is refused here
  const access = await resolvePortalAccess(token, "act")
  if (!access.ok) return access.response

  const body = await req.json().catch(() => ({}))

  const quote = await prisma.quote.findUnique({ where: { id: access.quoteId } })
  if (!quote) return linkInvalidResponse()

  // Acceptance requires a signature, a named signer, and agreeing to terms
  if (!body.signatureType || (body.signatureType !== "TYPED" && body.signatureType !== "DRAWN")) {
    return NextResponse.json({ error: "A signature is required" }, { status: 400 })
  }
  if (!body.signatureData || !String(body.signatureData).trim()) {
    return NextResponse.json({ error: "A signature is required" }, { status: 400 })
  }
  if (!body.signerName || !String(body.signerName).trim()) {
    return NextResponse.json({ error: "Signer name is required" }, { status: 400 })
  }
  if (!body.termsAgreed) {
    return NextResponse.json({ error: "You must agree to the terms and conditions" }, { status: 400 })
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      signatureType: body.signatureType,
      signatureData: body.signatureData,
      signerName: body.signerName.trim(),
      termsAgreedAt: new Date(),
      clientPoNumber: body.clientPoNumber || quote.clientPoNumber,
      shipAddress: body.shipAddress !== undefined ? body.shipAddress || null : quote.shipAddress,
      shipCity: body.shipCity !== undefined ? body.shipCity || null : quote.shipCity,
      shipState: body.shipState !== undefined ? body.shipState || null : quote.shipState,
      shipZip: body.shipZip !== undefined ? body.shipZip || null : quote.shipZip,
      shipCountry: body.shipCountry !== undefined ? body.shipCountry || null : quote.shipCountry,
      shipContactName: body.shipContactName !== undefined ? body.shipContactName || null : quote.shipContactName,
    },
    select: portalQuoteSelect,
  })

  notifyQuoteEvent(quote.id, "QUOTE_APPROVED").catch((err) =>
    console.error("notifyQuoteEvent failed:", err)
  )

  try {
    await createSalesOrderFromAcceptedQuote(quote.id)
  } catch (err) {
    console.error("createSalesOrderFromAcceptedQuote failed:", err)
  }

  return NextResponse.json(toPortalQuote(updated, false))
}