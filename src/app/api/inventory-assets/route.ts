import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"

// Flat, company-wide list of every InventoryAsset for the Inventory list
// page's Assets tab. Filtering/sorting all happens client-side against
// this array, matching every other list page in the app.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId

  const assets = await prisma.inventoryAsset.findMany({
    where: { companyId },
    select: {
      id: true,
      assetTag: true,
      status: true,
      ownerType: true,
      ownerClientId: true,
      ownerClient: { select: { name: true } },
      loanedToClientId: true,
      deployedToContactId: true,
      locationId: true,
      clientLocation: { select: { name: true } },
      catalogItem: {
        select: { name: true, categoryRef: { select: { name: true, parent: { select: { name: true } } } } },
      },
      deployedToContact: { select: { firstName: true, lastName: true } },
      loanedToContact: { select: { firstName: true, lastName: true } },
      assignedUser: { select: { name: true } },
    },
    orderBy: { assetTag: "asc" },
  })

  const locations = await prisma.inventoryLocation.findMany({
    where: { companyId },
    select: { id: true, name: true, parentId: true },
  })
  const pathById = new Map(buildLocationPathOptions(locations).map((p) => [p.id, p.label]))

  const result = assets.map((a) => ({
    ...a,
    containerPath: a.locationId ? pathById.get(a.locationId) ?? null : null,
  }))

  return NextResponse.json(result)
}
