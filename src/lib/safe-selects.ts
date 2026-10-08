import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

// Explicit selects for rows that also hold secrets. A route that returns
// CompanySettings or a DistributorIntegration must select through one of
// these, never return the row itself, so a secret column (Microsoft
// client secret, distributor API keys and tokens) can't ride along.

// ─── CompanySettings, one select per settings panel ──────────────────────

export const notificationSettingsSelect = {
  emailDefaultCc: true,
  emailSignature: true,
} satisfies Prisma.CompanySettingsSelect

export const quoteSettingsSelect = {
  quotePrefix: true,
  quoteExpiryDays: true,
  quoteTerms: true,
  quoteDefaultCc: true,
  quoteApprovalThreshold: true,
  quoteSendFromMode: true,
  quoteSendFromConnectionId: true,
} satisfies Prisma.CompanySettingsSelect

export const soPoSettingsSelect = {
  soPrefix: true,
  poPrefix: true,
  poDefaultPaymentType: true,
  soStatusNotifyRules: true,
} satisfies Prisma.CompanySettingsSelect

// ─── DistributorIntegration ──────────────────────────────────────────────

// Every column except the credentials and tokens. Client IDs are not
// secret and stay visible so an admin can see which app is configured.
export const distributorIntegrationSafeSelect = {
  id: true,
  distributor: true,
  enabled: true,
  priority: true,
  activeEnvironment: true,
  sandboxClientId: true,
  sandboxLastTestStatus: true,
  sandboxLastTestedAt: true,
  productionClientId: true,
  productionLastTestStatus: true,
  productionLastTestedAt: true,
  lastSyncedAt: true,
} satisfies Prisma.DistributorIntegrationSelect

// The credential fields the settings form edits, per environment. The
// partnerId column holds Amazon Business's refresh token, so it's treated
// as a secret too.
export const DISTRIBUTOR_SECRET_FIELDS = ["apiKey", "clientSecret", "partnerId"] as const
export type DistributorSecretField = (typeof DISTRIBUTOR_SECRET_FIELDS)[number]

export interface DistributorSecretPresence {
  hasSandboxApiKey: boolean
  hasSandboxClientSecret: boolean
  hasSandboxPartnerId: boolean
  hasProductionApiKey: boolean
  hasProductionClientSecret: boolean
  hasProductionPartnerId: boolean
}

export const NO_DISTRIBUTOR_SECRETS: DistributorSecretPresence = {
  hasSandboxApiKey: false,
  hasSandboxClientSecret: false,
  hasSandboxPartnerId: false,
  hasProductionApiKey: false,
  hasProductionClientSecret: false,
  hasProductionPartnerId: false,
}

// Which credentials are stored, as booleans only, keyed by distributor.
// The secret values are read here on the server and never leave it.
export async function loadDistributorSecretPresence(
  companyId: string
): Promise<Map<string, DistributorSecretPresence>> {
  const rows = await prisma.distributorIntegration.findMany({
    where: { companyId },
    select: {
      distributor: true,
      sandboxApiKey: true,
      sandboxClientSecret: true,
      sandboxPartnerId: true,
      productionApiKey: true,
      productionClientSecret: true,
      productionPartnerId: true,
    },
  })
  return new Map(
    rows.map((r) => [
      r.distributor,
      {
        hasSandboxApiKey: !!r.sandboxApiKey,
        hasSandboxClientSecret: !!r.sandboxClientSecret,
        hasSandboxPartnerId: !!r.sandboxPartnerId,
        hasProductionApiKey: !!r.productionApiKey,
        hasProductionClientSecret: !!r.productionClientSecret,
        hasProductionPartnerId: !!r.productionPartnerId,
      },
    ])
  )
}
