import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteEvent } from "@/lib/notify"
import { createSalesOrderFromAcceptedQuote } from "@/lib/sales-orders"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { checkAcceptBody, readPortalBody } from "@/lib/portal-input"
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

  // Acceptance requires a signature, a named signer, and agreeing to
  // terms. Every field is type and length checked (checkAcceptBody).
  const checked = checkAcceptBody(await readPortalBody(req))
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const input = checked.value

  const quote = await prisma.quote.findUnique({ where: { id: access.quoteId } })
  if (!quote) return linkInvalidResponse()

  // A field that wasn't sent keeps the quote's value; an empty PO number
  // keeps it too, as before
  const keep = <T>(sent: T | undefined, current: T) => (sent !== undefined ? sent : current)
  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      signatureType: input.signatureType,
      signatureData: input.signatureData,
      signerName: input.signerName,
      termsAgreedAt: new Date(),
      clientPoNumber: input.clientPoNumber || quote.clientPoNumber,
      shipAddress: keep(input.shipAddress, quote.shipAddress),
      shipCity: keep(input.shipCity, quote.shipCity),
      shipState: keep(input.shipState, quote.shipState),
      shipZip: keep(input.shipZip, quote.shipZip),
      shipCountry: keep(input.shipCountry, quote.shipCountry),
      shipContactName: keep(input.shipContactName, quote.shipContactName),
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