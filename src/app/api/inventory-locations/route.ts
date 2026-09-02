import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Returns the Container tree for one ClientLocation (a specific physical
// site). ?clientLocationId= is required — Containers only ever exist
// underneath a specific site, there's no more global company-wide list.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const clientLocationId = req.nextUrl.searchParams.get("clientLocationId")
  if (!clientLocationId) {
    return NextResponse.json({ error: "clientLocationId is required" }, { status: 400 })
  }

  const locations = await prisma.inventoryLocation.findMany({
    where: { clientLocationId, companyId: session.user.companyId },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(locations)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId
  const body = await req.json()
  const name = (body.name ?? "").trim()
  const parentId = body.parentId || null
  const clientLocationId = body.clientLocationId

  if (!clientLocationId) {
    return NextResponse.json({ error: "clientLocationId is required" }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: "Container name is required" }, { status: 400 })
  }

  const clientLocation = await prisma.clientLocation.findFirst({
    where: { id: clientLocationId, client: { companyId } },
  })
  if (!clientLocation) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 })
  }

  if (parentId) {
    // A parent Container must belong to the same site — Containers never
    // span across two different ClientLocations.
    const parent = await prisma.inventoryLocation.findUnique({
      where: { id: parentId, companyId, clientLocationId },
    })
    if (!parent) {
      return NextResponse.json({ error: "Parent container not found" }, { status: 404 })
    }
  }

  const location = await prisma.inventoryLocation.create({
    data: { companyId, clientLocationId, name, parentId },
  })

  return NextResponse.json(location)
}