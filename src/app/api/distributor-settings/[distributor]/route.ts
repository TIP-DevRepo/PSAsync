import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import {
  DISTRIBUTOR_SECRET_FIELDS,
  distributorIntegrationSafeSelect,
  loadDistributorSecretPresence,
  NO_DISTRIBUTOR_SECRETS,
} from "@/lib/safe-selects"

const VALID_DISTRIBUTORS = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

// Fields that can be explicitly emptied with clearFields. Secrets need
// this because a blank secret in a save now means "keep what's stored".
const CLEARABLE_FIELDS = ["clientId", ...DISTRIBUTOR_SECRET_FIELDS] as const

function columnFor(prefix: "sandbox" | "production", field: string) {
  return `${prefix}${field.charAt(0).toUpperCase()}${field.slice(1)}`
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ distributor: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.integrations"))) {
    return NextResponse.json({ error: "You don't have permission to change distributor settings" }, { status: 403 })
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

  if (body.environment === "SANDBOX" || body.environment === "PRODUCTION") {
    const prefix = body.environment === "SANDBOX" ? "sandbox" : "production"

    // The Client ID is shown in the form, so a blank one is a deliberate
    // clear, same as before
    if (body.clientId !== undefined) data[columnFor(prefix, "clientId")] = body.clientId || null

    // Secrets are never sent to the browser, so the form can't send the
    // stored value back. Omitted or blank means keep the stored value,
    // only a non-empty value replaces it.
    for (const field of DISTRIBUTOR_SECRET_FIELDS) {
      const value = body[field]
      if (typeof value === "string" && value !== "") data[columnFor(prefix, field)] = value
    }

    // Explicitly removing a stored value, e.g. clearFields: ["clientSecret"]
    if (Array.isArray(body.clearFields)) {
      for (const field of body.clearFields) {
        if ((CLEARABLE_FIELDS as readonly string[]).includes(field)) data[columnFor(prefix, field)] = null
      }
    }
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
    select: distributorIntegrationSafeSelect,
  })

  const presence = await loadDistributorSecretPresence(companyId)

  return NextResponse.json({ ...record, ...(presence.get(distributor) ?? NO_DISTRIBUTOR_SECRETS) })
}
