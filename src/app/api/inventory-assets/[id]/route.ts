import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

interface ContainerNode { id: string; name: string; parentId: string | null }

async function buildContainerPath(companyId: string, containerId: string): Promise<string> {
  const parts: string[] = []
  let currentId: string | null = containerId
  while (currentId) {
    const current: ContainerNode | null = await prisma.inventoryLocation.findUnique({
      where: { id: currentId, companyId },
      select: { id: true, name: true, parentId: true },
    })
    if (!current) break
    parts.unshift(current.name)
    currentId = current.parentId
  }
  return parts.join(" > ")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const asset = await prisma.inventoryAsset.findUnique({
    where: { id, companyId },
    include: {
      catalogItem: { select: { name: true, categoryRef: { select: { name: true, parent: { select: { name: true } } } } } },
      ownerClient: { select: { name: true } },
      clientLocation: { select: { name: true } },
      location: { select: { id: true, name: true } },
      customFieldValues: { include: { customField: { select: { name: true } } } },
    },
  })

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  const containerPath = asset.location ? await buildContainerPath(companyId, asset.location.id) : null

  return NextResponse.json({ ...asset, containerPath })
}