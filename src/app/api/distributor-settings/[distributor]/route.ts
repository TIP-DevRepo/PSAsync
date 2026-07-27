import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const VALID_DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

export async function PATCH(
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

  const body = await req.json()
  const companyId = session.user.companyId

  // Two independent things a save can do: update the credential fields for
  // ONE environment (body.environment says which), and/or switch which
  // environment is the active one (body.activeEnvironment). Either, both,
  // or neither can be present in a single request.
  const data: Record<string, unknown> = {
    enabled: body.enabled ?? false,
    priority: Number(body.priority) || 0,
  }

  if (body.environment === "SANDBOX") {
    data.sandboxApiKey = body.apiKey || null
    data.sandboxClientId = body.clientId || null
    data.sandboxClientSecret = body.clientSecret || null
    data.sandboxPartnerId = body.partnerId || null
  } else if (body.environment === "PRODUCTION") {
    data.productionApiKey = body.apiKey || null
    data.productionClientId = body.clientId || null
    data.productionClientSecret = body.clientSecret || null
    data.productionPartnerId = body.partnerId || null
  }

  if (body.activeEnvironment === "SANDBOX" || body.activeEnvironment === "PRODUCTION") {
    data.activeEnvironment = body.activeEnvironment
  }

  const record = await prisma.distributorIntegration.upsert({
    where: {
      companyId_distributor: {
        companyId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        distributor: distributor as any,
      },
    },
    update: data,
    create: {
      companyId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      distributor: distributor as any,
      activeEnvironment: (body.activeEnvironment ?? "SANDBOX") as "SANDBOX" | "PRODUCTION",
      ...data,
    },
  })

  return NextResponse.json(record)
}