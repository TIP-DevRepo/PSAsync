import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const client = await prisma.client.findUnique({
    where: { id, companyId: session.user.companyId },
    include: {
      contacts: {
        include: { tags: { include: { contactTag: true } } },
      },
      locations: {
        include: { billingContact: true, shippingContact: true },
      },
      mainBillingLocation: { include: { billingContact: true } },
      mainShippingLocation: { include: { shippingContact: true } },
      industryRef: true,
    },
  })

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  return NextResponse.json(client)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  // Verify this client actually belongs to the caller's company before
  // updating anything — id alone isn't enough to scope a Prisma update,
  // so this doubles as the ownership check the GET route already does.
  const existing = await prisma.client.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const body = await req.json()

  const {
    name,
    prefix,
    industryId,
    email,
    phone,
    website,
    status,
    notes,
    paymentTerms,
    mainBillingLocationId,
    mainShippingLocationId,
    isInternal,
  } = body

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Client name can't be blank" }, { status: 400 })
  }
  if (prefix !== undefined && !prefix.trim()) {
    return NextResponse.json({ error: "Company Prefix can't be blank" }, { status: 400 })
  }

  // Only one client per company can be marked as "your own company" at a
  // time. If this update is turning isInternal on, clear it from whichever
  // other client currently has it first, so the flag never lands on two
  // records at once.
  if (isInternal === true) {
    await prisma.client.updateMany({
      where: { companyId: session.user.companyId, isInternal: true, id: { not: id } },
      data: { isInternal: false },
    })
  }

  const client = await prisma.client.update({
    where: { id },
    data: {
      name,
      prefix: prefix !== undefined ? prefix.trim().toUpperCase() : undefined,
      industryId: industryId || null,
      email,
      phone,
      website,
      status,
      notes,
      paymentTerms: paymentTerms || null,
      mainBillingLocationId: mainBillingLocationId || null,
      mainShippingLocationId: mainShippingLocationId || null,
      ...(isInternal !== undefined ? { isInternal } : {}),
    },
  })

  return NextResponse.json(client)
}