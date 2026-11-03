import type { Prisma } from "@/generated/prisma"
import { isPrismaError } from "@/lib/opportunity-rules"

// Record numbers for quotes, sales orders, and purchase orders look like
// Q-2026-0001: the company's prefix, the year the record is created, and a
// sequence padded to at least four digits. The sequence keeps counting
// across years instead of starting over each January. Tickets add their own
// key here later. Opportunities keep their own counter
// (src/lib/opportunity-number.ts).
export type NumberSequenceKey = "quote" | "salesOrder" | "purchaseOrder"

export function formatRecordNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`
}

// The sequence part of a number in that format, or null for anything else.
// The prefix may itself hold hyphens, so only the year and sequence at the
// end are read.
export function sequenceOfNumber(number: string): number | null {
  const match = /-\d{4}-(\d+)$/.exec(number)
  if (!match) return null
  const sequence = Number(match[1])
  return Number.isSafeInteger(sequence) ? sequence : null
}

type Tx = Prisma.TransactionClient

// What a company already has for each key: every stored number, and the
// row count the old "count plus one" numbering used (quote families, not
// versions, since every version shares its family's number)
const EXISTING: Record<NumberSequenceKey, (tx: Tx, companyId: string) => Promise<{ numbers: string[]; legacyCount: number }>> = {
  quote: async (tx, companyId) => {
    const [rows, legacyCount] = await Promise.all([
      tx.quote.findMany({ where: { companyId }, select: { quoteNumber: true } }),
      tx.quote.count({ where: { companyId, version: 1 } }),
    ])
    return { numbers: rows.map((r) => r.quoteNumber), legacyCount }
  },
  salesOrder: async (tx, companyId) => {
    const rows = await tx.salesOrder.findMany({ where: { companyId }, select: { soNumber: true } })
    return { numbers: rows.map((r) => r.soNumber), legacyCount: rows.length }
  },
  purchaseOrder: async (tx, companyId) => {
    const rows = await tx.purchaseOrder.findMany({ where: { companyId }, select: { poNumber: true } })
    return { numbers: rows.map((r) => r.poNumber), legacyCount: rows.length }
  },
}

// The sequence a new counter starts at: after the highest sequence any
// stored number holds, whatever its prefix or year, and never below what the
// old numbering would have given next (the row count plus one), so the
// numbers a company sees carry straight on
export function firstSequence(numbers: string[], legacyCount: number): number {
  let highest = legacyCount
  for (const number of numbers) {
    const sequence = sequenceOfNumber(number)
    if (sequence !== null && sequence > highest) highest = sequence
  }
  return highest + 1
}

// One atomic increment of an existing counter. Postgres runs it one
// transaction at a time for the same row, and the row stays locked until
// the caller's transaction ends, so the read after it sees this
// transaction's own value. Null when the company has no counter yet.
async function incrementSequence(tx: Tx, companyId: string, key: NumberSequenceKey): Promise<number | null> {
  const updated = await tx.numberSequence.updateMany({
    where: { companyId, key },
    data: { nextValue: { increment: 1 } },
  })
  if (updated.count === 0) return null
  const row = await tx.numberSequence.findUniqueOrThrow({
    where: { companyId_key: { companyId, key } },
    select: { nextValue: true },
  })
  return row.nextValue - 1
}

// Takes the company's next sequence for this key and moves the counter on.
// Call it inside the transaction that creates the record, so a failed
// create gives the number back.
//
// The first time a company needs a key there is no counter row to lock, so
// the transaction locks the company's own row instead (SELECT ... FOR NO KEY
// UPDATE, which leaves foreign key checks on other tables alone, the same
// lock ensureTeamDefaults takes) and looks again. Two first requests for the
// same company then run one after the other: the second finds the counter
// the first created and increments it.
export async function takeNextNumber(tx: Tx, companyId: string, key: NumberSequenceKey): Promise<number> {
  const taken = await incrementSequence(tx, companyId, key)
  if (taken !== null) return taken

  await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR NO KEY UPDATE`
  const afterLock = await incrementSequence(tx, companyId, key)
  if (afterLock !== null) return afterLock

  const existing = await EXISTING[key](tx, companyId)
  const sequence = firstSequence(existing.numbers, existing.legacyCount)
  await tx.numberSequence.create({ data: { companyId, key, nextValue: sequence + 1 } })
  return sequence
}

// The next formatted number, for example SO-2026-0042
export async function takeRecordNumber(tx: Tx, companyId: string, key: NumberSequenceKey, prefix: string, now = new Date()): Promise<string> {
  return formatRecordNumber(prefix, now.getFullYear(), await takeNextNumber(tx, companyId, key))
}

// A create that still collides with a stored number (a row written outside
// the counter, for example by an instance still running the old numbering
// during a deploy) is a unique constraint error. Routes answer it with a
// 409 instead of a server error. Only the number is unique on these
// creates (their tokens are random), so the code alone is enough.
export const NUMBER_TAKEN_MESSAGE = "That number is already in use. Please try again."

export function isNumberCollision(err: unknown): boolean {
  return isPrismaError(err, "P2002")
}
