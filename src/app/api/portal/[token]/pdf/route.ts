import { NextRequest, NextResponse } from "next/server"
import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"
import { buildQuotePdfHtml } from "@/lib/quote-pdf-template"
import { resolveQuoteTerms } from "@/lib/quote-terms"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { consumeSubject, linkLimitedResponse } from "@/lib/rate-limit"
import { attachmentDisposition, quotePdfName } from "@/lib/content-disposition"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // A read: works for an accepted quote past its expiry date, and for the
  // staff internal preview
  const access = await resolvePortalAccess(token, "view", { allowInternal: true, request: req })
  if (!access.ok) return access.response
  const activeId = access.quoteId

  // Each download starts a headless browser, so a customer link has its own
  // limit per hour (the signed in internal preview is not limited)
  if (!access.isInternal) {
    const limit = await consumeSubject("portal-pdf", token)
    if (limit.blocked) return linkLimitedResponse(limit.retryAfterSeconds)
  }

  const quote = await prisma.quote.findUnique({
    where: { id: activeId },
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

  if (!quote) return linkInvalidResponse()

  const effectiveTerms = resolveQuoteTerms(quote, quote.company.settings?.quoteTerms)
  const html = buildQuotePdfHtml({ ...quote, effectiveTerms }, {
    name: quote.company.name,
    logoUrl: quote.company.logoUrl,
    primaryColor: quote.company.settings?.primaryColor ?? "#1B3A5C",
    accentColor: quote.company.settings?.accentColor ?? "#2E86AB",
  })

  const isVercel = !!process.env.VERCEL

  const browser = isVercel
    ? await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      })
    : await (await import("puppeteer")).launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "load" })
    const pdfBuffer = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    })

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        // Built from the stored quote number, so through the shared helper
        "Content-Disposition": attachmentDisposition(quotePdfName(quote.quoteNumber, quote.version), "quote.pdf"),
      },
    })
  } finally {
    await browser.close()
  }
}