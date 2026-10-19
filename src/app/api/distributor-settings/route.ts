import { NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"
import {
  distributorIntegrationSafeSelect,
  loadDistributorSecretPresence,
  NO_DISTRIBUTOR_SECRETS,
} from "@/lib/safe-selects"

const DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"] as const

export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.integrations",
    message: "You do not have permission to view distributor settings",
  })
  if (response) return response

  const companyId = ctx.companyId
  const [existing, presence] = await Promise.all([
    prisma.distributorIntegration.findMany({
      where: { companyId },
      select: distributorIntegrationSafeSelect,
    }),
    loadDistributorSecretPresence(companyId),
  ])

  // Always return one entry per known distributor, even if it hasn't been
  // configured yet, so the settings page always shows all four cards.
  // Credentials come back only as has* booleans, never their values.
  const result = DISTRIBUTORS.map((key) => {
    const match = existing.find((d) => d.distributor === key)
    if (match) return { ...match, ...(presence.get(key) ?? NO_DISTRIBUTOR_SECRETS) }
    return {
      id: null,
      distributor: key,
      enabled: false,
      priority: 0,
      activeEnvironment: "SANDBOX",
      sandboxClientId: "",
      sandboxLastTestStatus: null,
      sandboxLastTestedAt: null,
      productionClientId: "",
      productionLastTestStatus: null,
      productionLastTestedAt: null,
      lastSyncedAt: null,
      ...NO_DISTRIBUTOR_SECRETS,
    }
  })

  return NextResponse.json(result)
}
