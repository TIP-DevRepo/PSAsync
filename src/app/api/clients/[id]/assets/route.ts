import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id: clientId } = await params
  const companyId = session.user.companyId

  const client = await prisma.client.findUnique({ where: { id: clientId, companyId }, select: { id: true } })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Covers both ownership paths: assets this client actually owns
  // (Sold), and assets that are still company-owned but currently out
  // on loan to this client (Loaned never transfers ownership).
  const assets = await prisma.inventoryAsset.findMany({
    where: {
      companyId,
      OR: [
        { ownerType: "CLIENT", ownerClientId: clientId },
        { loanedToClientId: clientId },
      ],
    },
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      status: true,
      ownerClientId: true,
      loanedToClientId: true,
      deployedToContactId: true,
      locationId: true,
      clientLocation: { select: { name: true } },
      catalogItem: { select: { name: true } },
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
