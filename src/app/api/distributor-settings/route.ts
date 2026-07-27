import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"] as const

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const existing = await prisma.distributorIntegration.findMany({
    where: { companyId: session.user.companyId },
  })

  // Always return one entry per known distributor, even if it hasn't been
  // configured yet, so the settings page always shows all four cards
  const result = DISTRIBUTORS.map((key) => {
    const match = existing.find((d) => d.distributor === key)
    return (
      match ?? {
        id: null,
        distributor: key,
        enabled: false,
        priority: 0,
        activeEnvironment: "SANDBOX",
        sandboxApiKey: "",
        sandboxClientId: "",
        sandboxClientSecret: "",
        sandboxPartnerId: "",
        sandboxLastTestStatus: null,
        sandboxLastTestedAt: null,
        productionApiKey: "",
        productionClientId: "",
        productionClientSecret: "",
        productionPartnerId: "",
        productionLastTestStatus: null,
        productionLastTestedAt: null,
        lastSyncedAt: null,
      }
    )
  })

  return NextResponse.json(result)
}