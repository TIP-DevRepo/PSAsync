import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getAdapter } from "@/lib/distributors/registry"
import { DistributorKey } from "@/lib/distributors/types"

const VALID_DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

// Which credential fields each distributor needs before a connection is
// considered "ready". Real distributor API calls come later (Week 3 risk
// note: build the UI now with mock validation, swap in real APIs once
// credentials are approved).
const REQUIRED_FIELDS: Record<string, string[]> = {
  INGRAM_MICRO: ["clientId", "clientSecret", "apiKey"],
  TD_SYNNEX: ["clientId", "clientSecret"],
  DH: ["apiKey"],
  AMAZON_BUSINESS: ["clientId", "clientSecret"],
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ distributor: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { distributor } = await params
  if (!VALID_DISTRIBUTORS.includes(distributor)) {
    return NextResponse.json({ error: "Unknown distributor" }, { status: 400 })
  }

  const companyId = session.user.companyId

  const record = await prisma.distributorIntegration.findUnique({
    where: {
      companyId_distributor: {
        companyId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        distributor: distributor as any,
      },
    },
  })

  const required = REQUIRED_FIELDS[distributor] ?? []
  const missing = required.filter(
    (field) => !record || !(record as Record<string, unknown>)[field]
  )

  let success: boolean
  let status: string

  if (missing.length > 0) {
    success = false
    status = `Missing: ${missing.join(", ")}`
  } else {
    const adapter = getAdapter(distributor as DistributorKey)

    if (adapter.isLive) {
      const creds = {
        apiKey: record?.apiKey ?? "",
        clientId: record?.clientId ?? "",
        clientSecret: record?.clientSecret ?? "",
        partnerId: record?.partnerId ?? "",
      }
      const result = await adapter.testConnection(
        creds,
        record?.sandboxMode ?? true
      )
      success = result.success
      status = result.status
    } else {
      success = true
      status = "Connected (mock — real API pending credential approval)"
    }
  }

  if (record) {
    await prisma.distributorIntegration.update({
      where: { id: record.id },
      data: { lastTestStatus: status, lastTestedAt: new Date() },
    })
  }

  return NextResponse.json({ success, status })
}