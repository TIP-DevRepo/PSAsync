// Builds a standalone, print-ready HTML document for a quote. Used by the
// PDF generation route (rendered via Puppeteer) - this is NOT a React
// component, just a plain HTML string with inline <style>, since Puppeteer
// renders it independently of the Next.js app.

interface PdfLineItem {
  section: string | null
  sortOrder: number
  name: string
  description: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  discount: number
  isRecurring: boolean
  recurringInterval: string | null
  isOptional: boolean
  optionalSelected: boolean
  isTextBlock: boolean
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
}

interface PdfQuote {
  quoteNumber: string
  version: number
  title: string | null
  introText: string | null
  terms: string | null
  clientPoNumber: string | null
  expiresAt: Date | null
  createdAt: Date
  taxRate: number
  client: { name: string }
  contact: { firstName: string; lastName: string } | null
  user: { name: string; email: string }
  lineItems: PdfLineItem[]
}

interface PdfCompany {
  name: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
}

const NO_SECTION = "__no_section__"

function money(n: number) {
  return `$${n.toFixed(2)}`
}

function lineTotal(li: PdfLineItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function buildQuotePdfHtml(quote: PdfQuote, company: PdfCompany): string {
  const countedItems = quote.lineItems.filter(
    (li) => !li.isTextBlock && (!li.isOptional || li.optionalSelected)
  )
  const oneTime = countedItems.filter((li) => !li.isRecurring)
  const oneTimeSubtotal = oneTime.reduce((sum, li) => sum + lineTotal(li), 0)
  const tax = oneTimeSubtotal * (quote.taxRate / 100)
  const grandTotal = oneTimeSubtotal + tax

  const recurringByInterval: Record<string, number> = { MONTHLY: 0, QUARTERLY: 0, ANNUALLY: 0 }
  countedItems
    .filter((li) => li.isRecurring && li.recurringInterval)
    .forEach((li) => {
      recurringByInterval[li.recurringInterval as string] += lineTotal(li)
    })

  const sectionKeys: string[] = []
  quote.lineItems
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((li) => {
      const key = li.section ?? NO_SECTION
      if (!sectionKeys.includes(key)) sectionKeys.push(key)
    })

  const sectionsHtml = sectionKeys
    .map((sectionKey) => {
      const items = quote.lineItems
        .filter((li) => (li.section ?? NO_SECTION) === sectionKey)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const seenBundles = new Set<string>()
      const groups: {
        header: PdfLineItem | null
        bundleItems: PdfLineItem[] | null
        item: PdfLineItem | null
      }[] = []
      items.forEach((li) => {
        if (li.isBundleHeader) {
          if (!li.bundleName || seenBundles.has(li.bundleName)) return
          seenBundles.add(li.bundleName)
          const members = items.filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
          groups.push({ header: li, bundleItems: members, item: null })
        } else if (li.bundleName && items.some((x) => x.isBundleHeader && x.bundleName === li.bundleName)) {
          // Rendered as part of its header's group instead
          return
        } else {
          groups.push({ header: null, bundleItems: null, item: li })
        }
      })

      const renderRow = (li: PdfLineItem) => {
        if (li.isTextBlock) {
          return `
            <tr>
              <td colspan="3" style="padding-top:12px;">
                <div class="item-name">${escapeHtml(li.name)}</div>
                ${li.description ? `<div class="item-desc" style="white-space:pre-wrap;">${escapeHtml(li.description)}</div>` : ""}
              </td>
            </tr>`
        }
        const skipped = li.isOptional && !li.optionalSelected
        return `
            <tr>
              <td>
                <div class="item-name">${escapeHtml(li.name)}</div>
                ${li.description ? `<div class="item-desc">${escapeHtml(li.description)}</div>` : ""}
                ${li.isRecurring ? `<div class="item-desc">Recurring — ${escapeHtml((li.recurringInterval || "").toLowerCase())}</div>` : ""}
              </td>
              <td class="num">${li.quantity} × ${money(li.unitPrice)}</td>
              <td class="num">${skipped ? '<span class="muted">Not included</span>' : money(lineTotal(li))}</td>
            </tr>`
      }

      const rows = groups
        .map((g) => {
          if (g.bundleItems && g.header) {
            const mode = g.header.bundleDisplayMode ?? "COLLAPSED"
            if (mode !== "ITEMIZED") {
              const counted = g.bundleItems.filter((x) => !x.isOptional || x.optionalSelected)
              const bundleTotal = counted.reduce((sum, x) => sum + lineTotal(x), 0)
              return `
            <tr>
              <td>
                <div class="item-name">${escapeHtml(g.header.name)}</div>
                <div class="item-desc">${g.bundleItems.length} items</div>
              </td>
              <td class="num"></td>
              <td class="num">${money(bundleTotal)}</td>
            </tr>`
            }
            const headerRow = `
            <tr>
              <td colspan="3" style="padding-top:12px;">
                <div class="item-name">${escapeHtml(g.header.name)}</div>
              </td>
            </tr>`
            return headerRow + g.bundleItems.map((li) => renderRow(li)).join("")
          }
          return renderRow(g.item as PdfLineItem)
        })
        .join("")

      return `
        <table class="items">
          <thead>
            <tr><th colspan="3" class="section-head" style="background:${company.accentColor}">${
        sectionKey === NO_SECTION ? "Items" : escapeHtml(sectionKey)
      }</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
    })
    .join("")

  const recurringRows = (["MONTHLY", "QUARTERLY", "ANNUALLY"] as const)
    .filter((k) => recurringByInterval[k] > 0)
    .map(
      (k) => `
        <div class="total-row">
          <span>${k.charAt(0) + k.slice(1).toLowerCase()} Recurring</span>
          <span>${money(recurringByInterval[k])}</span>
        </div>`
    )
    .join("")

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 0; font-size: 12px; }
  .header { background: ${company.primaryColor}; color: #fff; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header img { height: 40px; }
  .header .company-name { font-size: 16px; font-weight: bold; }
  .body { padding: 24px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #888; }
  .meta { margin: 12px 0 20px; font-size: 12px; color: #444; }
  .meta div { margin-bottom: 2px; }
  .intro { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 16px; white-space: pre-wrap; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
  table.items .section-head { color: #fff; text-align: left; padding: 6px 10px; font-size: 12px; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.items .num { text-align: right; white-space: nowrap; }
  .item-name { font-weight: bold; }
  .item-desc { color: #666; font-size: 11px; }
  .totals { width: 260px; margin-left: auto; margin-top: 16px; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .total-row { display: flex; justify-content: space-between; padding: 2px 0; }
  .total-row.grand { font-weight: bold; border-top: 1px solid #ddd; margin-top: 6px; padding-top: 6px; }
  .terms { margin-top: 24px; font-size: 10px; color: #666; white-space: pre-wrap; border-top: 1px solid #ddd; padding-top: 12px; }
  .footer { text-align: center; font-size: 10px; color: #999; padding: 16px; }
</style>
</head>
<body>
  <div class="header">
    <div style="display:flex; align-items:center; gap:10px;">
      ${company.logoUrl ? `<img src="${company.logoUrl}" />` : ""}
      <span class="company-name">${escapeHtml(company.name)}</span>
    </div>
  </div>

  <div class="body">
    <h1>${escapeHtml(quote.quoteNumber)}${quote.version > 1 ? ` v${quote.version}` : ""}</h1>
    ${quote.title ? `<p class="muted">${escapeHtml(quote.title)}</p>` : ""}

    <div class="meta">
      <div><strong>Prepared for:</strong> ${escapeHtml(quote.client.name)}${
    quote.contact ? ` — ${escapeHtml(quote.contact.firstName)} ${escapeHtml(quote.contact.lastName)}` : ""
  }</div>
      <div><strong>Prepared by:</strong> ${escapeHtml(quote.user.name)}</div>
      <div><strong>Date:</strong> ${quote.createdAt.toLocaleDateString()}</div>
      ${quote.expiresAt ? `<div><strong>Valid until:</strong> ${quote.expiresAt.toLocaleDateString()}</div>` : ""}
      ${quote.clientPoNumber ? `<div><strong>Client PO #:</strong> ${escapeHtml(quote.clientPoNumber)}</div>` : ""}
    </div>

    ${quote.introText ? `<div class="intro">${escapeHtml(quote.introText)}</div>` : ""}

    ${sectionsHtml}

    <div class="totals">
      <div class="total-row"><span>Subtotal</span><span>${money(oneTimeSubtotal)}</span></div>
      <div class="total-row"><span>Tax (${quote.taxRate}%)</span><span>${money(tax)}</span></div>
      <div class="total-row grand"><span>Total</span><span>${money(grandTotal)}</span></div>
      ${recurringRows}
    </div>

    ${quote.terms ? `<div class="terms"><strong>Terms &amp; Conditions</strong><br/>${escapeHtml(quote.terms)}</div>` : ""}
  </div>

  <div class="footer">Generated by ${escapeHtml(company.name)} via PSAsync</div>
</body>
</html>`
}