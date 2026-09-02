import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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

  const client = await prisma.client.findUnique({ where: { id, companyId } })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }
  if (client.inventoryOnboarded) {
    return NextResponse.json({ error: "This client is already onboarded for Inventory" }, { status: 400 })
  }

  let prefix = client.prefix
  if (!prefix) {
    const providedPrefix = (body.prefix ?? "").trim().toUpperCase()
    if (!providedPrefix) {
      return NextResponse.json({ error: "A Company Prefix is required to onboard for Inventory" }, { status: 400 })
    }
    prefix = providedPrefix
  }

  const updated = await prisma.client.update({
    where: { id },
    data: { inventoryOnboarded: true, prefix },
  })

  return NextResponse.json(updated)
}