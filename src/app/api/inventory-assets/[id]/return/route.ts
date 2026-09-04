import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId
  const body = await req.json()

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }
  if (!["SOLD", "LOANED", "INTERNAL"].includes(asset.status)) {
    return NextResponse.json({ error: "This asset isn't in a state that can be returned" }, { status: 400 })
  }

  if (!body.containerId) {
    return NextResponse.json({ error: "Select a container to return this to" }, { status: 400 })
  }
  const container = await prisma.inventoryLocation.findUnique({
    where: { id: body.containerId, companyId },
    select: { clientLocationId: true },
  })
  if (!container) {
    return NextResponse.json({ error: "Container not found" }, { status: 404 })
  }

  // Internal is a simple, immediate return — never leaves company
  // ownership or touches a client, so no reason and no Pending Offboard.
  if (asset.status === "INTERNAL") {
    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: {
        status: "IN_STOCK",
        assignedUserId: null,
        locationId: body.containerId,
        clientLocationId: container.clientLocationId,
      },
    })
    await logAssetEvent(id, "RETURNED", "Returned to stock from internal checkout", session.user.id)
    return NextResponse.json(updated)
  }

  if (asset.status === "LOANED") {
    // Loaned returns always go through Pending Offboard, no reason needed.
    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: {
        status: "PENDING_OFFBOARD",
        locationId: body.containerId,
        clientLocationId: container.clientLocationId,
        loanedToClientId: null,
        loanedToContactId: null,
        loanExpectedReturnDate: null,
      },
    })
    await logAssetEvent(id, "RETURNED", "Loan returned, pending offboard", session.user.id)
    return NextResponse.json(updated)
  }

  // SOLD
  const reason: "REFUND" | "DISPOSAL" | "HOLDING_STOCK" | undefined = body.reason
  if (!reason) {
    return NextResponse.json({ error: "A return reason is required (Refund, Disposal, or Holding Stock)" }, { status: 400 })
  }

  if (reason === "HOLDING_STOCK") {
    // Ownership stays with the client, item just physically sits in our
    // warehouse now — no offboarding needed, it's meant to stay theirs.
    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: {
        status: "IN_STOCK",
        locationId: body.containerId,
        clientLocationId: container.clientLocationId,
        deployedToContactId: null,
      },
    })
    await logAssetEvent(id, "RETURNED", "Returned, held in stock for client", session.user.id)
    return NextResponse.json(updated)
  }

  // Refund or Disposal — both go to Pending Offboard, ownership doesn't
  // change until someone finalizes it.
  const updated = await prisma.inventoryAsset.update({
    where: { id },
    data: {
      status: "PENDING_OFFBOARD",
      locationId: body.containerId,
      clientLocationId: container.clientLocationId,
      deployedToContactId: null,
      pendingDisposal: reason === "DISPOSAL",
    },
  })
  await logAssetEvent(
    id,
    "RETURNED",
    `Returned for ${reason === "DISPOSAL" ? "disposal" : "refund"}, pending offboard`,
    session.user.id
  )
  return NextResponse.json(updated)
}