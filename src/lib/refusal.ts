import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

// A request refused inside a locked transaction (the opportunity and ticket
// settings locks, the action button lock). Returning one rolls the
// transaction back, so a refused request changes nothing.
export interface Refusal {
  refused: true
  status: 400 | 404 | 409
  error: string
  code?: string
}

export function refuse(status: Refusal["status"], error: string, code?: string): Refusal {
  return { refused: true, status, error, code }
}

export function isRefusal(value: unknown): value is Refusal {
  return !!value && typeof value === "object" && (value as Refusal).refused === true
}

class RollBack extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.error)
  }
}

// Runs fn in one transaction. When fn returns a Refusal the transaction is
// rolled back (whatever it wrote, and the lock it took) and the Refusal is
// returned; anything else commits.
export async function refusableTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T | Refusal>): Promise<T | Refusal> {
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await fn(tx)
      if (isRefusal(result)) throw new RollBack(result)
      return result
    })
  } catch (err) {
    if (err instanceof RollBack) return err.refusal
    throw err
  }
}
