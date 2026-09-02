import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { generateAssetTag } from "@/lib/inventory/generateAssetTag"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id: poId, lineItemId } = await params
  const companyId = session.user.companyId

  const lineItem = await prisma.pOLineItem.findUnique({
    where: { id: lineItemId },
    include: {
      purchaseOrder: true,
      catalogItem: true,
    },
  })

  if (!lineItem || lineItem.purchaseOrder.companyId !== companyId) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 })
  }
  if (lineItem.purchaseOrderId !== poId) {
    return NextResponse.json({ error: "Line item does not belong to this Purchase Order" }, { status: 400 })
  }
  if (lineItem.received) {
    return NextResponse.json({ error: "This line item has already been received" }, { status: 400 })
  }
  if (!lineItem.catalogItem) {
    return NextResponse.json({ error: "This line item isn't linked to a Catalog Item, receiving requires one" }, { status: 400 })
  }

  const po = lineItem.purchaseOrder
  const body = await req.json()

  // Asset Tag prefix always comes from whoever the item was purchased
  // for — the PO's linked client, whether that came from a Sales Order
  // or was picked directly on a standalone PO. Falls back to the
  // company's own internal client record if neither is set.
  const tagClientId = po.shipToClientId ?? undefined

  try {
    if (lineItem.catalogItem.isSerialized) {
      // ── Serialized: one InventoryAsset per unit ─────────────────────
      const quantity = Math.round(lineItem.quantity)
      const serialNumbers: string[] = Array.isArray(body.serialNumbers) ? body.serialNumbers : []

      if (serialNumbers.length !== quantity) {
        return NextResponse.json(
          { error: `Expected ${quantity} serial number(s), received ${serialNumbers.length}` },
          { status: 400 }
        )
      }
      if (serialNumbers.some((s) => !s || !s.trim())) {
        return NextResponse.json({ error: "Every serial number is required, none can be blank" }, { status: 400 })
      }

      let ownerType: "COMPANY" | "CLIENT"
      let ownerClientId: string | null = null
      let clientLocationId: string | null = null
      let locationId: string | null = null
      let status: "IN_STOCK" | "SOLD"

      if (po.shipToClient) {
        if (!po.shipToClientId) {
          return NextResponse.json(
            { error: "This Purchase Order ships to a client, but no client is linked to it. Edit the Purchase Order and confirm a client is selected." },
            { status: 400 }
          )
        }
        // Prefer the real location captured at PO creation. Fall back to
        // whatever was already locked in from a prior receipt on this PO,
        // and only as a last resort (e.g. a Sales-Order-linked PO, which
        // has no real location link) ask the user to pick one now.
        clientLocationId = po.shipToClientLocationId ?? po.receivingClientLocationId
        if (!clientLocationId) {
          if (!body.clientLocationId) {
            return NextResponse.json(
              { error: "Select which of this client's locations these items are shipping to" },
              { status: 400 }
            )
          }
          clientLocationId = body.clientLocationId
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { receivingClientLocationId: clientLocationId },
          })
        }
        ownerType = "CLIENT"
        ownerClientId = po.shipToClientId
        // An item shipping directly to a client on receipt has already
        // effectively been sold, the Sales Order is what represents
        // that sale, receiving is just fulfilling it.
        status = "SOLD"

        // If the client is onboarded for Inventory and has built out a
        // Container tree under that specific site, the asset gets
        // stocked at whichever Container was picked. Otherwise it just
        // sits at the flat ClientLocation with no Container, same as
        // before onboarding existed.
        if (body.containerLocationId && clientLocationId) {
          const container = await prisma.inventoryLocation.findUnique({
            where: { id: body.containerLocationId, companyId, clientLocationId },
          })
          if (!container) {
            return NextResponse.json({ error: "Container not found" }, { status: 404 })
          }
          locationId = body.containerLocationId
        }
      } else {
        if (!body.locationId) {
          return NextResponse.json({ error: "Select which warehouse location these items are being stored at" }, { status: 400 })
        }
        const location = await prisma.inventoryLocation.findUnique({ where: { id: body.locationId, companyId } })
        if (!location) {
          return NextResponse.json({ error: "Location not found" }, { status: 404 })
        }
        ownerType = "COMPANY"
        locationId = body.locationId
        status = "IN_STOCK"
      }

      const createdAssetIds: string[] = []
      for (const serialNumber of serialNumbers) {
        const assetTag = await generateAssetTag(companyId, tagClientId)

        const asset = await prisma.inventoryAsset.create({
          data: {
            companyId,
            catalogItemId: lineItem.catalogItem.id,
            assetTag,
            serialNumber: serialNumber.trim(),
            status,
            ownerType,
            ownerClientId,
            clientLocationId,
            locationId,
          },
        })

        await prisma.inventoryAssetEvent.create({
          data: {
            assetId: asset.id,
            eventType: "CREATED",
            description: `Created by receiving Purchase Order ${po.poNumber}`,
            performedByUserId: session.user.id,
          },
        })

        createdAssetIds.push(asset.id)
      }

      // Link each entered serial number back to the PO line item and
      // the specific asset it produced, for traceability from the PO.
      await prisma.pOLineItemSerial.createMany({
        data: serialNumbers.map((serialNumber, i) => ({
          lineItemId: lineItem.id,
          serialNumber: serialNumber.trim(),
          assetId: createdAssetIds[i],
        })),
      })
    } else {
      // ── Non-serialized: bump pooled InventoryStock, or skip entirely
      // if shipping direct to a client (not tracked in Inventory, per
      // the accepted gap) ──────────────────────────────────────────────
      if (!po.shipToClient) {
        if (!body.locationId) {
          return NextResponse.json({ error: "Select which warehouse location this stock is being stored at" }, { status: 400 })
        }
        const location = await prisma.inventoryLocation.findUnique({ where: { id: body.locationId, companyId } })
        if (!location) {
          return NextResponse.json({ error: "Location not found" }, { status: 404 })
        }

        const quantity = Math.round(lineItem.quantity)
        const stock = await prisma.inventoryStock.upsert({
          where: { catalogItemId_locationId: { catalogItemId: lineItem.catalogItem.id, locationId: body.locationId } },
          create: { companyId, catalogItemId: lineItem.catalogItem.id, locationId: body.locationId, quantity },
          update: { quantity: { increment: quantity } },
        })

        await prisma.inventoryStockEvent.create({
          data: {
            stockId: stock.id,
            eventType: "RECEIVED",
            quantityChange: quantity,
            description: `Received via Purchase Order ${po.poNumber}`,
            performedByUserId: session.user.id,
          },
        })
      }
      // shipToClient non-serialized: intentionally not tracked in Inventory.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't complete receiving"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const updatedLineItem = await prisma.pOLineItem.update({
    where: { id: lineItemId },
    data: { received: true },
  })

  // Same auto-advance behavior as the existing PATCH route: once every
  // line item is received, move the PO itself to Received.
  const allItems = await prisma.pOLineItem.findMany({ where: { purchaseOrderId: poId } })
  const allReceived = allItems.every((li) => li.received)
  if (allReceived && po.status === "PARTS_ORDERED") {
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "RECEIVED", receivedAt: new Date() },
    })
  }

  return NextResponse.json(updatedLineItem)
}