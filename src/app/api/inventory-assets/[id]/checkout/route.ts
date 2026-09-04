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
  const type: "SOLD" | "LOANED" | "INTERNAL" = body.type

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  // Two starting states can be "checked out": our own company's stock
  // (the normal Sold/Loaned/Internal flow below), or stock a client
  // already owns but hasn't been handed to anyone yet — checking that
  // out just means deploying it to one of the client's contacts.
  const isCompanyStock = asset.status === "IN_STOCK" && asset.ownerType === "COMPANY"
  const isClientStockAwaitingDeploy =
    asset.status === "SOLD" && asset.ownerType === "CLIENT" && !asset.deployedToContactId

  if (isClientStockAwaitingDeploy) {
    if (!body.contactId) {
      return NextResponse.json({ error: "A contact is required" }, { status: 400 })
    }
    const contact = await prisma.contact.findUnique({
      where: { id: body.contactId, clientId: asset.ownerClientId as string },
    })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
    }
    const clientLocationId = body.clientLocationId ?? contact.locationId ?? asset.clientLocationId
    if (!clientLocationId) {
      return NextResponse.json({ error: "Select which of the client's sites this is deployed at" }, { status: 400 })
    }

    const updated = await prisma.inventoryAsset.update({
      where: { id },
      data: { deployedToContactId: contact.id, clientLocationId, locationId: null },
    })
    await logAssetEvent(id, "CHECKED_OUT", `Checked out from stock, deployed to ${contact.firstName} ${contact.lastName}`, session.user.id)
    return NextResponse.json(updated)
  }

  if (!isCompanyStock) {
    return NextResponse.json({ error: "This asset can't be checked out from its current state" }, { status: 400 })
  }

  // A container's site tells us which ClientLocation this asset now sits
  // at, regardless of who owns it — this stays consistent whether the
  // container belongs to the target client's own site or to our own
  // internal company's warehouse.
  async function resolveContainerSite(containerId: string): Promise<string> {
    const container = await prisma.inventoryLocation.findUnique({
      where: { id: containerId, companyId },
      select: { clientLocationId: true },
    })
    if (!container) throw new Error("Container not found")
    return container.clientLocationId
  }

  try {
    if (type === "SOLD") {
      if (!body.clientId) return NextResponse.json({ error: "A client is required" }, { status: 400 })
      const client = await prisma.client.findUnique({ where: { id: body.clientId, companyId } })
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

      if (body.containerId && body.contactId) {
        return NextResponse.json({ error: "Pick either a container or a contact to deploy to, not both" }, { status: 400 })
      }

      let locationId: string | null = null
      let clientLocationId: string | null = null
      let deployedToContactId: string | null = null

      if (body.containerId) {
        clientLocationId = await resolveContainerSite(body.containerId)
        locationId = body.containerId
      } else if (body.contactId) {
        const contact = await prisma.contact.findUnique({ where: { id: body.contactId, clientId: client.id } })
        if (!contact) return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
        deployedToContactId = contact.id
        clientLocationId = body.clientLocationId ?? contact.locationId ?? null
        if (!clientLocationId) {
          return NextResponse.json({ error: "Select which of the client's sites this is deployed at" }, { status: 400 })
        }
      } else if (body.clientLocationId) {
        // Neither container nor contact — Unknown, but still needs a site
        // to group under.
        clientLocationId = body.clientLocationId
      } else {
        return NextResponse.json({ error: "Select a container, a contact, or at least a client site" }, { status: 400 })
      }

      const updated = await prisma.inventoryAsset.update({
        where: { id },
        data: {
          status: "SOLD",
          ownerType: "CLIENT",
          ownerClientId: client.id,
          locationId,
          clientLocationId,
          deployedToContactId,
        },
      })

      await logAssetEvent(
        id,
        "CHECKED_OUT",
        deployedToContactId
          ? `Sold and deployed to ${client.name}`
          : `Sold to ${client.name}${locationId ? "" : " (unsorted)"}`,
        session.user.id
      )

      return NextResponse.json(updated)
    }

    if (type === "LOANED") {
      if (!body.clientId || !body.contactId || !body.loanExpectedReturnDate) {
        return NextResponse.json({ error: "Client, contact, and expected return date are required" }, { status: 400 })
      }
      const client = await prisma.client.findUnique({ where: { id: body.clientId, companyId } })
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })
      const contact = await prisma.contact.findUnique({ where: { id: body.contactId, clientId: client.id } })
      if (!contact) return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })

      const clientLocationId = body.clientLocationId ?? contact.locationId ?? null
      if (!clientLocationId) {
        return NextResponse.json({ error: "Select which of the client's sites this is loaned to" }, { status: 400 })
      }

      const updated = await prisma.inventoryAsset.update({
        where: { id },
        data: {
          status: "LOANED",
          loanedToClientId: client.id,
          loanedToContactId: contact.id,
          loanExpectedReturnDate: new Date(body.loanExpectedReturnDate),
          locationId: null,
          clientLocationId,
        },
      })

      await logAssetEvent(id, "CHECKED_OUT", `Loaned to ${client.name}`, session.user.id)

      return NextResponse.json(updated)
    }

    if (type === "INTERNAL") {
      if (!body.userId) return NextResponse.json({ error: "A user is required" }, { status: 400 })
      const user = await prisma.user.findUnique({ where: { id: body.userId, companyId } })
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

      const updated = await prisma.inventoryAsset.update({
        where: { id },
        data: {
          status: "INTERNAL",
          assignedUserId: user.id,
          locationId: null,
          clientLocationId: null,
        },
      })

      await logAssetEvent(id, "CHECKED_OUT", `Checked out internally to ${user.name}`, session.user.id)

      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: "Invalid checkout type" }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't complete checkout"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}