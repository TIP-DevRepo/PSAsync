import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { DISTRIBUTOR_LABELS, DistributorKey } from "@/lib/distributors/types"

// A lightweight, credential-free list of which distributors are currently
// enabled for this company, used to populate the distributor filter
// checkboxes in search. Never exposes API keys/secrets, unlike the full
// distributor-settings endpoint, which is admin-only. Any active user.
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const enabled = await prisma.distributorIntegration.findMany({
    where: { companyId: ctx.companyId, enabled: true },
    orderBy: { priority: "asc" },
    select: { distributor: true },
  })

  const options = enabled.map((r) => ({
    key: r.distributor as DistributorKey,
    label: DISTRIBUTOR_LABELS[r.distributor as DistributorKey],
  }))

  return NextResponse.json(options)
}
