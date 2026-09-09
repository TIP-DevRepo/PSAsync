import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

// Changes who currently holds an already-deployed asset (Internal user,
// Loaned contact, or Sold-and-deployed contact) without touching status
// or ownership — the heavier Return -> Offboard -> Check Out cycle is
// for when the asset is actually coming back or changing hands entirely.
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

  if (asset.status === "INTERNAL") {
    if (!body.userId) {
      return NextResponse.json({ error: "A user is required" }, { status: 400 })
    }
    const user = await prisma.user.findUnique({ where: { id: body.userId, companyId } })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: { assignedUserId: user.id },
    })
    await logAssetEvent(id, "MOVED", `Redeployed internally to ${user.name}`, session.user.id)
    return NextResponse.json(updated)
  }

  if (asset.status === "LOANED") {
    if (!asset.loanedToClientId) {
      return NextResponse.json({ error: "This asset isn't loaned to a client" }, { status: 400 })
    }
    if (!body.contactId) {
      return NextResponse.json({ error: "A contact is required" }, { status: 400 })
    }
    const contact = await prisma.contact.findUnique({ where: { id: body.contactId, clientId: asset.loanedToClientId } })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
    }

    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: {
        loanedToContactId: contact.id,
        ...(contact.locationId ? { clientLocationId: contact.locationId } : {}),
        ...(body.loanExpectedReturnDate ? { loanExpectedReturnDate: new Date(body.loanExpectedReturnDate) } : {}),
      },
    })
    await logAssetEvent(id, "MOVED", `Redeployed to ${contact.firstName} ${contact.lastName}`, session.user.id)
    return NextResponse.json(updated)
  }

  if (asset.status === "SOLD" && asset.deployedToContactId) {
    if (!asset.ownerClientId) {
      return NextResponse.json({ error: "This asset isn't owned by a client" }, { status: 400 })
    }
    if (!body.contactId) {
      return NextResponse.json({ error: "A contact is required" }, { status: 400 })
    }
    const contact = await prisma.contact.findUnique({ where: { id: body.contactId, clientId: asset.ownerClientId } })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
    }

    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: {
        deployedToContactId: contact.id,
        ...(contact.locationId ? { clientLocationId: contact.locationId } : {}),
      },
    })
    await logAssetEvent(id, "MOVED", `Redeployed to ${contact.firstName} ${contact.lastName}`, session.user.id)
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: "This asset isn't currently deployed" }, { status: 400 })
}
