import { NextResponse } from "next/server"
import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"
import { errorSummary } from "@/lib/user-error"

// Every PDF the app makes (the staff quote PDF, the customer portal and
// internal preview PDF, and the PDF attached to a quote email) is rendered
// here by a headless browser. When the browser can't start or can't render
// the page, the caller gets null and answers PDF_UNAVAILABLE (a 503, or a
// refused send) with a plain message; the server log says which step failed
// and why, never the page, a token, or customer data.

export const PDF_UNAVAILABLE_MESSAGE = "We couldn't create the PDF right now. Please try again in a minute."
export const PDF_UNAVAILABLE_CODE = "PDF_UNAVAILABLE"

export function pdfUnavailableResponse() {
  return NextResponse.json({ error: PDF_UNAVAILABLE_MESSAGE, code: PDF_UNAVAILABLE_CODE }, { status: 503 })
}

interface PdfBrowser {
  newPage(): Promise<{
    setContent(html: string, options: { waitUntil: "load" }): Promise<unknown>
    pdf(options: Record<string, unknown>): Promise<Uint8Array>
  }>
  close(): Promise<void>
}

// On Vercel, the lightweight serverless Chromium. Locally, the full
// puppeteer package (a dev dependency), since the serverless binary only
// runs on Vercel's servers.
async function launchBrowser(): Promise<PdfBrowser> {
  if (process.env.VERCEL) {
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  }
  return (await import("puppeteer")).launch({ headless: true })
}

// The page as a US letter PDF with no margins (the template sets its own),
// or null when the browser failed. context names the PDF in the log line.
export async function renderPdf(html: string, context: string, launch: () => Promise<PdfBrowser> = launchBrowser): Promise<Buffer<ArrayBuffer> | null> {
  let browser: PdfBrowser
  try {
    browser = await launch()
  } catch (err) {
    console.error(`${context}: the PDF browser couldn't start: ${errorSummary(err)}`)
    return null
  }
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "load" })
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    })
    return Buffer.from(pdf)
  } catch (err) {
    console.error(`${context}: the PDF couldn't be rendered: ${errorSummary(err)}`)
    return null
  } finally {
    await browser.close().catch(() => undefined)
  }
}
