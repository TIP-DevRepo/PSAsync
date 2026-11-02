// DEV ONLY. Sending a quote with no opportunity, or moving it out of Draft
// through the status route, makes the app create an opportunity for it
// (src/lib/opportunity-quotes.ts). A check that sends one of the run's
// sample quotes takes the company's opportunity ids first and removes every
// opportunity added since when it puts its data back, so later checks see
// the run's opportunities exactly as they were set up.

import type { PrismaClient } from "@/generated/prisma"

export async function opportunityIdsOf(prisma: PrismaClient, companyIds: string[]): Promise<string[]> {
  const rows = await prisma.opportunity.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } })
  return rows.map((r) => r.id)
}

// Unlinks and deletes every opportunity of these companies that isn't in
// before, with its audit entries (its timeline entries and attachments go
// with it). Returns how many it removed.
export async function removeOpportunitiesAddedSince(prisma: PrismaClient, companyIds: string[], before: string[]): Promise<number> {
  const added = await prisma.opportunity.findMany({ where: { companyId: { in: companyIds }, id: { notIn: before } }, select: { id: true } })
  const ids = added.map((o) => o.id)
  if (ids.length === 0) return 0
  await prisma.quote.updateMany({ where: { opportunityId: { in: ids } }, data: { opportunityId: null } })
  await prisma.salesOrder.updateMany({ where: { opportunityId: { in: ids } }, data: { opportunityId: null } })
  await prisma.purchaseOrder.updateMany({ where: { opportunityId: { in: ids } }, data: { opportunityId: null } })
  await prisma.auditLogEntry.deleteMany({ where: { companyId: { in: companyIds }, recordId: { in: ids } } })
  await prisma.opportunity.deleteMany({ where: { id: { in: ids } } })
  return ids.length
}
