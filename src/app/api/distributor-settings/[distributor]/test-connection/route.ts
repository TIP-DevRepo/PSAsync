import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getAdapter } from "@/lib/distributors/registry"
import { DistributorKey } from "@/lib/distributors/types"

const VALID_DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

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

  // Which environment to test — defaults to whichever is currently active
  // if the caller doesn't specify (e.g. testing whichever tab is open)
  const body = await req.json().catch(() => ({}))
  const testEnv: "SANDBOX" | "PRODUCTION" = body.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX"
  const isSandbox = testEnv === "SANDBOX"

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

  const prefix = isSandbox ? "sandbox" : "production"
  const getField = (name: string) =>
    record ? (record as unknown as Record<string, string | null>)[`${prefix}${name}`] : null

  const required = REQUIRED_FIELDS[distributor] ?? []
  const fieldMap: Record<string, string> = {
    apiKey: "ApiKey",
    clientId: "ClientId",
    clientSecret: "ClientSecret",
    partnerId: "PartnerId",
  }
  const missing = required.filter((field) => !getField(fieldMap[field]))

  let success: boolean
  let status: string

  if (missing.length > 0) {
    success = false
    status = `Missing: ${missing.join(", ")}`
  } else {
    const adapter = getAdapter(distributor as DistributorKey)

    if (adapter.isLive) {
      const creds = {
        apiKey: getField("ApiKey") ?? "",
        clientId: getField("ClientId") ?? "",
        clientSecret: getField("ClientSecret") ?? "",
        partnerId: getField("PartnerId") ?? "",
      }
      const result = await adapter.testConnection(creds, isSandbox)
      success = result.success
      status = result.status
    } else {
      success = true
      status = `Connected (mock — real API pending credential approval) [${testEnv}]`
    }
  }

  if (record) {
    await prisma.distributorIntegration.update({
      where: { id: record.id },
      data: {
        [`${prefix}LastTestStatus`]: status,
        [`${prefix}LastTestedAt`]: new Date(),
      },
    })
  }

  return NextResponse.json({ success, status, environment: testEnv })
}