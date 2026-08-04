import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const quote = await prisma.quote.findUnique({
    where: { id, companyId: session.user.companyId },
    include: {
      client: { select: { id: true, name: true, email: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      user: { select: { id: true, name: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  return NextResponse.json(quote)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "quotes.edit"))) {
    return NextResponse.json({ error: "You don't have permission to edit quotes" }, { status: 403 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const existing = await prisma.quote.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft quotes can be edited this way." }, { status: 400 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}

  if (body.clientId !== undefined) {
    const client = await prisma.client.findUnique({ where: { id: body.clientId, companyId } })
    if (!client) {
      return NextResponse.json({ error: "Invalid client" }, { status: 400 })
    }
    data.clientId = body.clientId
  }

  if (body.contactId !== undefined) {
    if (body.contactId === null) {
      data.contactId = null
    } else {
      const contact = await prisma.contact.findUnique({ where: { id: body.contactId } })
      const effectiveClientId = (data.clientId as string | undefined) ?? existing.clientId
      if (!contact || contact.clientId !== effectiveClientId) {
        return NextResponse.json({ error: "Invalid contact for this client" }, { status: 400 })
      }
      data.contactId = body.contactId
    }
  }

  if (body.title !== undefined) data.title = body.title || null
  if (body.introText !== undefined) data.introText = body.introText || null
  if (body.terms !== undefined) data.terms = body.terms || null
  if (body.useDefaultTerms !== undefined) data.useDefaultTerms = !!body.useDefaultTerms
  if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null

  const updated = await prisma.quote.update({ where: { id }, data })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "quotes.delete"))) {
    return NextResponse.json({ error: "You don't have permission to delete quotes" }, { status: 403 })
  }

  const { id } = await params

  const quote = await prisma.quote.findUnique({
    where: { id, companyId: session.user.companyId },
    include: { salesOrder: { select: { id: true } } },
  })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }
  if (quote.salesOrder) {
    return NextResponse.json(
      { error: "This quote has a Sales Order linked to it and can't be deleted." },
      { status: 400 }
    )
  }

  await prisma.quote.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}