import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ClientStatus } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs, clientWhere, loadClient } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Open to any active user: forms on other pages load a client's contacts
  // and locations from here
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const client = await prisma.client.findUnique({
    where: { id, companyId: ctx.companyId },
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
  const { ctx, response } = await requireAccess({
    permission: "clients.edit",
    message: "You do not have permission to edit clients",
  })
  if (response) return response

  const { id } = await params

  // Verify this client actually belongs to the caller's company before
  // updating anything — id alone isn't enough to scope a Prisma update,
  // so this doubles as the ownership check the GET route already does.
  const existing = await loadClient(ctx, id)
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
  if (status !== undefined && !isEnumValue(ClientStatus, status)) {
    return apiError(400, "Invalid status")
  }

  // Main billing and shipping must be locations of this same client
  const invalid = await assertRefs(ctx, {
    industryId,
    clientId: id,
    clientLocationId: [mainBillingLocationId, mainShippingLocationId],
  })
  if (invalid) return invalid

  // Only one client per company can be marked as "your own company" at a
  // time. If this update is turning isInternal on, clear it from whichever
  // other client currently has it first, so the flag never lands on two
  // records at once.
  if (isInternal === true) {
    await prisma.client.updateMany({
      where: { companyId: ctx.companyId, isInternal: true, id: { not: id } },
      data: { isInternal: false },
    })
  }

  const client = await prisma.client.update({
    where: clientWhere(ctx, id),
    data: {
      name,
      prefix: prefix !== undefined ? (prefix.trim() ? prefix.trim().toUpperCase() : null) : undefined,
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