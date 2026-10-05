import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

// A stock row's quantity represents real physical units sitting in a
// container — deleting it while quantity is still positive would silently
// lose track of that hardware, so it must be adjusted down to 0 first
// (via the existing Adjust flow) before the row itself can go away.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "inventory.delete"))) {
    return NextResponse.json({ error: "You don't have permission to delete inventory stock" }, { status: 403 })
  }

  const { id } = await params
  const companyId = session.user.companyId

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
