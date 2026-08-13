import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DISTRIBUTOR_LABELS, DistributorKey } from "@/lib/distributors/types"

// A lightweight, credential-free list of which distributors are currently
// enabled for this company, used to populate the distributor filter
// checkboxes in search. Never exposes API keys/secrets, unlike the full
// distributor-settings endpoint, which is admin-only.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const enabled = await prisma.distributorIntegration.findMany({
    where: { companyId: session.user.companyId, enabled: true },
    orderBy: { priority: "asc" },
    select: { distributor: true },
  })

  const options = enabled.map((r) => ({
    key: r.distributor as DistributorKey,
    label: DISTRIBUTOR_LABELS[r.distributor as DistributorKey],
  }))

  return NextResponse.json(options)
}