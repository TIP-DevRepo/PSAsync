import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Pull every quote (not just active ones) so we can spot draft siblings
  const allQuotes = await prisma.quote.findMany({
    where: { companyId: session.user.companyId },
    include: {
      client: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { id: true, name: true } },
      lineItems: { select: { unitPrice: true, quantity: true, discount: true } },
      comments: {
        where: { authorType: "CLIENT" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // Group by quote number so we can pair each active version with any
  // in-progress draft revision sitting alongside it
  const families = new Map<string, typeof allQuotes>()
  for (const q of allQuotes) {
    const list = families.get(q.quoteNumber) ?? []
    list.push(q)
    families.set(q.quoteNumber, list)
  }

  const result = []
  for (const group of families.values()) {
    const active = group.find((q) => q.isActive) ?? group[0]
    const draft = group
      .filter((q) => q.id !== active.id && !q.isActive && ["DRAFT", "PENDING_APPROVAL"].includes(q.status))
      .sort((a, b) => b.version - a.version)[0]

    const total = active.lineItems.reduce((sum, li) => {
      return sum + li.unitPrice * li.quantity * (1 - li.discount / 100)
    }, 0)

    const lastClientComment = active.comments[0]
    const hasUnreadComment = !!(
      lastClientComment &&
      (!active.lastCommentViewedAt || lastClientComment.createdAt > active.lastCommentViewedAt)
    )

    result.push({
      id: active.id,
      quoteNumber: active.quoteNumber,
      version: active.version,
      status: active.status,
      title: active.title,
      accessToken: active.accessToken,
      flagged: active.flagged,
      templateId: active.templateId,
      clientName: active.client.name,
      contactName: active.contact ? `${active.contact.firstName} ${active.contact.lastName}` : null,
      owner: active.user,
      total,
      hasUnreadComment,
      createdAt: active.createdAt,
      sentAt: active.sentAt,
      expiresAt: active.expiresAt,
      acceptedAt: active.acceptedAt,
      draftVersionId: draft?.id ?? null,
      draftVersionNumber: draft?.version ?? null,
    })
  }

  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()

  if (!body.clientId) {
    return NextResponse.json({ error: "A client is required" }, { status: 400 })
  }

  const companyId = session.user.companyId

  // Pull default terms/expiry from Company Settings
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
  })
  const prefix = settings?.quotePrefix ?? "Q"

  // If a template was selected, load it (with its line items) to prefill from.
  // Every field carries over as-is from the template line item — pricing,
  // bundles, choice groups, text blocks, recurring settings, everything —
  // so a template is a true starting point, not just a name/qty shell.
  let templateLineItems: {
    catalogItemId: string | null
    section: string | null
    sortOrder: number
    name: string
    description: string | null
    sku: string | null
    quantity: number
    unitPrice: number
    cost: number
    discount: number
    taxable: boolean
    isRecurring: boolean
    recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null
    isOptional: boolean
    optionalSelected: boolean
    quantityAdjustable: boolean
    choiceGroup: string | null
    isTextBlock: boolean
    bundleName: string | null
    bundleDisplayMode: string | null
    isBundleHeader: boolean
  }[] = []
  let templateTerms: string | null = null
  let templateSections: string[] = []

  if (body.templateId) {
    const template = await prisma.quoteTemplate.findUnique({
      where: { id: body.templateId, companyId },
      include: { lineItems: true },
    })

    if (template) {
      templateTerms = template.terms
      templateSections = template.sections
      templateLineItems = template.lineItems.map((tli) => ({
        catalogItemId: tli.catalogItemId,
        section: tli.section,
        sortOrder: tli.sortOrder,
        name: tli.name,
        description: tli.description,
        sku: tli.sku,
        quantity: tli.quantity,
        unitPrice: tli.unitPrice,
        cost: tli.cost,
        discount: tli.discount,
        taxable: tli.taxable,
        isRecurring: tli.isRecurring,
        recurringInterval: tli.recurringInterval,
        isOptional: tli.isOptional,
        optionalSelected: tli.optionalSelected,
        quantityAdjustable: tli.quantityAdjustable,
        choiceGroup: tli.choiceGroup,
        isTextBlock: tli.isTextBlock,
        bundleName: tli.bundleName,
        bundleDisplayMode: tli.bundleDisplayMode,
        isBundleHeader: tli.isBundleHeader,
      }))
    }
  }

  // Generate the next sequential quote number for this company
  const year = new Date().getFullYear()
  // Count quote *families*, not every row — each family has exactly one
  // version-1 row, so counting those (not all versions) keeps numbering
  // sequential for genuinely new quotes regardless of how many revisions
  // any existing quote has
  const existingCount = await prisma.quote.count({ where: { companyId, version: 1 } })
  const quoteNumber = `${prefix}-${year}-${String(existingCount + 1).padStart(4, "0")}`

  // Expiry date: explicit date from the form, or today + expiry days
  const expiryDays = Number(body.expiryDays) || settings?.quoteExpiryDays || 30
  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt)
    : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)

  const quote = await prisma.quote.create({
    data: {
      companyId,
      clientId: body.clientId,
      contactId: body.contactId || null,
      userId: body.userId || session.user.id,
      quoteNumber,
      templateId: body.templateId || null,
      title: body.title || null,
      introText: body.introText || null,
      terms: body.terms || templateTerms || settings?.quoteTerms || null,
      internalNotes: body.internalNotes || null,
      shipAddress: body.shipAddress || null,
      shipAddress2: body.shipAddress2 || null,
      shipCity: body.shipCity || null,
      shipState: body.shipState || null,
      shipZip: body.shipZip || null,
      shipCountry: body.shipCountry || null,
      paymentTerms: body.paymentTerms || null,
      expiresAt,
      sections: templateSections,
      lineItems: {
        create: templateLineItems,
      },
    },
  })

  return NextResponse.json(quote)
}