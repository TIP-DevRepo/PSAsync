import { NextRequest, NextResponse } from "next/server"
import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"
import { buildQuotePdfHtml } from "@/lib/quote-pdf-template"
import { resolveQuoteTerms } from "@/lib/quote-terms"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { viewableQuoteWhere } from "@/lib/scoped-loaders"

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

  // On Vercel, use the lightweight serverless Chromium.
  // On your local machine, fall back to the full puppeteer package (installed as a dev dependency) since the serverless binary only runs on Vercel's servers.
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
        "Content-Disposition": `attachment; filename="${quote.quoteNumber}${
          quote.version > 1 ? `-v${quote.version}` : ""
        }.pdf"`,
      },
    })
  } finally {
    await browser.close()
  }
}