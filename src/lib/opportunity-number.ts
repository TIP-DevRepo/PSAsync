import type { Prisma } from "@/generated/prisma"

// Opportunity numbers look like OPP-2026-0001: the company's prefix, the
// year the opportunity is created, and a sequence padded to four digits,
// the same format quote numbers use. Like quote numbers, the sequence
// keeps counting across years instead of starting over each January.
export function formatOpportunityNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`
}

// Takes the company's next number. Quote numbers count the existing rows
// and add one, which two requests at the same moment can both get, so
// opportunities keep a counter on their settings row instead: one atomic
// increment, which Postgres runs one request at a time for the same row.
// Call it inside the transaction that creates the opportunity, so a failed
// create gives the number back. Callers run ensureOpportunityDefaults first.
export async function takeOpportunityNumber(tx: Prisma.TransactionClient, companyId: string, now = new Date()): Promise<string> {
  const settings = await tx.opportunitySettings.update({
    where: { companyId },
    data: { nextNumber: { increment: 1 } },
    select: { prefix: true, nextNumber: true },
  })
  return formatOpportunityNumber(settings.prefix, now.getFullYear(), settings.nextNumber - 1)
}
