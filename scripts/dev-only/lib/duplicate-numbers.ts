// The record number columns that carry a unique constraint (see
// prisma/schema.prisma) and how to find rows that would break it, for
// report-duplicate-numbers.ts. Type-only imports here, so loading this file
// never touches the database.

import type { PrismaClient } from "@/generated/prisma"

export interface NumberRow {
  id: string
  companyId: string
  // The value the constraint covers, as a person reads it: the number, and
  // for quotes the version too ("Q-2026-0003 v1")
  number: string
  createdAt: Date
  label: string
}

export interface NumberSource {
  // The model and the columns its unique constraint covers
  model: string
  constraint: string
  load: (db: PrismaClient) => Promise<NumberRow[]>
}

export interface DuplicateGroup {
  model: string
  companyId: string
  number: string
  rows: NumberRow[]
}

// One source per unique record number. Labels are what a person would look
// for in the app: the quote title or client, the sales order's client, the
// purchase order's vendor.
export const NUMBER_SOURCES: NumberSource[] = [
  {
    model: "Quote",
    constraint: "(companyId, quoteNumber, version)",
    load: async (db) =>
      (
        await db.quote.findMany({
          select: { id: true, companyId: true, quoteNumber: true, version: true, createdAt: true, title: true, client: { select: { name: true } } },
        })
      ).map((r) => ({
        id: r.id,
        companyId: r.companyId,
        number: `${r.quoteNumber} v${r.version}`,
        createdAt: r.createdAt,
        label: r.title ? `${r.client.name}: ${r.title}` : r.client.name,
      })),
  },
  {
    model: "SalesOrder",
    constraint: "(companyId, soNumber)",
    load: async (db) =>
      (
        await db.salesOrder.findMany({ select: { id: true, companyId: true, soNumber: true, createdAt: true, client: { select: { name: true } } } })
      ).map((r) => ({ id: r.id, companyId: r.companyId, number: r.soNumber, createdAt: r.createdAt, label: r.client.name })),
  },
  {
    model: "PurchaseOrder",
    constraint: "(companyId, poNumber)",
    load: async (db) =>
      (
        await db.purchaseOrder.findMany({ select: { id: true, companyId: true, poNumber: true, createdAt: true, vendor: { select: { name: true } } } })
      ).map((r) => ({ id: r.id, companyId: r.companyId, number: r.poNumber, createdAt: r.createdAt, label: r.vendor.name })),
  },
]

// Every company and number held by more than one row, ordered by company,
// then number, and each group's rows oldest first
export function findDuplicates(model: string, rows: NumberRow[]): DuplicateGroup[] {
  const groups = new Map<string, NumberRow[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.companyId, row.number])
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({
      model,
      companyId: list[0].companyId,
      number: list[0].number,
      rows: [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.companyId.localeCompare(b.companyId) || a.number.localeCompare(b.number))
}
