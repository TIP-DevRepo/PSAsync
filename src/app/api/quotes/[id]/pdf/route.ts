import { NextRequest, NextResponse } from "next/server"
import { buildQuotePdfHtml } from "@/lib/quote-pdf-template"
import { pdfUnavailableResponse, renderPdf } from "@/lib/pdf-render"
import { resolveQuoteTerms } from "@/lib/quote-terms"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"
import { attachmentDisposition, quotePdfName } from "@/lib/content-disposition"

// PDF rendering needs the Node.js runtime (not Edge) and more time than the
// default serverless timeout allows
export const runtime = "nodejs"
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: {
      client: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { name: true, email: true } },
      company: {
        select: {
          name: true,
          logoUrl: true,
          settings: { select: { primaryColor: true, accentColor: true, quoteTerms: true } },
        },
      },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })

  if (!quote) return notFound()

  const effectiveTerms = resolveQuoteTerms(quote, quote.company.settings?.quoteTerms)
  const html = buildQuotePdfHtml({ ...quote, effectiveTerms }, {
    name: quote.company.name,
    logoUrl: quote.company.logoUrl,
    primaryColor: quote.company.settings?.primaryColor ?? "#1B3A5C",
    accentColor: quote.company.settings?.accentColor ?? "#2E86AB",
  })

  // A browser that can't start or render answers PDF_UNAVAILABLE (503)
  const pdf = await renderPdf(html, "Staff quote PDF")
  if (!pdf) return pdfUnavailableResponse()

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      // Built from the stored quote number, so through the shared helper
      "Content-Disposition": attachmentDisposition(quotePdfName(quote.quoteNumber, quote.version), "quote.pdf"),
    },
  })
}