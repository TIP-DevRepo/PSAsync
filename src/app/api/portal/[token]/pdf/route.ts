import { NextRequest, NextResponse } from "next/server"
import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"
import { buildQuotePdfHtml } from "@/lib/quote-pdf-template"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
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
  const access = await resolvePortalAccess(token, "view", { allowInternal: true })
  if (!access.ok) return access.response
  const activeId = access.quoteId

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
          settings: { select: { primaryColor: true, accentColor: true } },
        },
      },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })

  if (!quote) return linkInvalidResponse()

  const html = buildQuotePdfHtml(quote, {
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
        "Content-Disposition": `attachment; filename="${quote.quoteNumber}${
          quote.version > 1 ? `-v${quote.version}` : ""
        }.pdf"`,
      },
    })
  } finally {
    await browser.close()
  }
}