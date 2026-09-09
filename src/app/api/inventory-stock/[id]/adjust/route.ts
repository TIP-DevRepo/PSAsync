import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Manual quantity adjustment for a pooled InventoryStock row. PO
// receiving is the only other thing that changes quantity today; this
// covers corrections, damage, counts, etc. Always logs an ADJUSTED event
// with the signed delta.
export async function PATCH(
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
  const delta = Number(body.delta)

  if (!Number.isInteger(delta) || delta === 0) {
    return NextResponse.json({ error: "A non-zero whole-number delta is required" }, { status: 400 })
  }

  const stock = await prisma.inventoryStock.findUnique({ where: { id, companyId } })
  if (!stock) {
    return NextResponse.json({ error: "Stock record not found" }, { status: 404 })
  }

  const newQuantity = stock.quantity + delta
  if (newQuantity < 0) {
    return NextResponse.json({ error: "Adjustment would result in negative quantity" }, { status: 400 })
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : `Manually adjusted by ${delta > 0 ? "+" : ""}${delta}`

  const [updated] = await prisma.$transaction([
    prisma.inventoryStock.update({ where: { id }, data: { quantity: newQuantity } }),
    prisma.inventoryStockEvent.create({
      data: {
        stockId: id,
        eventType: "ADJUSTED",
        quantityChange: delta,
        description,
        performedByUserId: session.user.id,
      },
    }),
  ])

  return NextResponse.json(updated)
}
