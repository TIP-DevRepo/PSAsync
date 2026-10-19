import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// A stock row's quantity represents real physical units sitting in a
// container — deleting it while quantity is still positive would silently
// lose track of that hardware, so it must be adjusted down to 0 first
// (via the existing Adjust flow) before the row itself can go away.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "inventory.delete",
    message: "You do not have permission to delete inventory stock",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const stock = await prisma.inventoryStock.findUnique({ where: { id, companyId } })
  if (!stock) {
    return NextResponse.json({ error: "Stock record not found" }, { status: 404 })
  }

  if (stock.quantity > 0) {
    return NextResponse.json(
      { error: "This stock still has quantity on hand. Adjust it down to 0 first, then delete it." },
      { status: 409 }
    )
  }

  await prisma.inventoryStock.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}
