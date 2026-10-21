import type { OpportunityStageCategory, Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

// A company's opportunity stages, types, and settings are created the first
// time any opportunity, stage, type, or settings route runs for it, never
// at company creation and never by a data migration.

export const DEFAULT_OPPORTUNITY_PREFIX = "OPP"

// In this order (sortOrder 0 to 5)
export const DEFAULT_OPPORTUNITY_STAGES: readonly { name: string; category: OpportunityStageCategory; winProbability: number }[] = [
  { name: "New", category: "OPEN", winProbability: 10 },
  { name: "Qualified", category: "OPEN", winProbability: 25 },
  { name: "Proposal", category: "OPEN", winProbability: 50 },
  { name: "Negotiation", category: "OPEN", winProbability: 75 },
  { name: "Won", category: "WON", winProbability: 100 },
  { name: "Lost", category: "LOST", winProbability: 0 },
]

export const DEFAULT_OPPORTUNITY_TYPES: readonly string[] = ["New Business", "Upsell", "Renewal"]

// The default stage a sent quote moves its opportunity to
export const DEFAULT_QUOTE_SENT_STAGE = "Proposal"

// Creates the company's default stages, types, and settings (prefix OPP, a
// sent quote moving to Proposal) when it has none yet. Safe to call on every
// request: once the settings row exists it is a single read.
//
// Safe under concurrency because the one per company settings row is the
// claim. Inside one transaction, the request that inserts it (INSERT ... ON
// CONFLICT DO NOTHING on the unique companyId) creates everything else. A
// request racing it blocks on that unique index until the winner commits,
// then inserts nothing and returns, so the defaults are created exactly
// once, and all at once. If the winner fails, its transaction rolls back
// the settings row too and the next request tries again.
export async function ensureOpportunityDefaults(companyId: string): Promise<void> {
  const existing = await prisma.opportunitySettings.findUnique({ where: { companyId }, select: { id: true } })
  if (existing) return

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.opportunitySettings.createMany({
      data: [{ companyId, prefix: DEFAULT_OPPORTUNITY_PREFIX }],
      skipDuplicates: true,
    })
    if (claimed.count === 0) return

    // A company that somehow has stages already keeps them as they are
    if ((await tx.opportunityStage.count({ where: { companyId } })) > 0) return

    await tx.opportunityStage.createMany({
      data: DEFAULT_OPPORTUNITY_STAGES.map((stage, i) => ({ companyId, ...stage, sortOrder: i })),
    })
    await tx.opportunityType.createMany({
      data: DEFAULT_OPPORTUNITY_TYPES.map((name, i) => ({ companyId, name, sortOrder: i })),
    })
    const quoteSentStage = await tx.opportunityStage.findFirst({
      where: { companyId, name: DEFAULT_QUOTE_SENT_STAGE, category: "OPEN" },
      select: { id: true },
    })
    await tx.opportunitySettings.update({
      where: { companyId },
      data: { quoteSentStageId: quoteSentStage?.id ?? null },
    })
  })
}

// Locks the company's opportunity settings row until the transaction ends,
// and returns it. Writes that must keep the stage rules true together (at
// least one stage per category, the quote sent stage existing and OPEN)
// take this first, so two of them for the same company run one after the
// other instead of each passing its check on stale rows. The write only
// moves updatedAt. Callers run ensureOpportunityDefaults first.
export function lockOpportunitySettings(tx: Prisma.TransactionClient, companyId: string) {
  return tx.opportunitySettings.update({
    where: { companyId },
    data: { updatedAt: new Date() },
    select: { prefix: true, quoteSentStageId: true },
  })
}
