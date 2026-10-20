import { prisma } from "@/lib/prisma"
import { UserError } from "@/lib/user-error"

// Generates the next Asset Tag for a given client, e.g. "ACM-0001", then
// "ACM-0002" next time. Each client has its own independent running
// sequence (Client.nextAssetSequence). If no clientId is given, falls
// back to whichever client is marked as the company's own internal one.
//
// Throws a UserError if the resolved client has no prefix set, so the
// route can show its message and the user can set one before receiving
// hardware for that client.
export async function generateAssetTag(companyId: string, clientId?: string): Promise<string> {
  const client = clientId
    ? await prisma.client.findUnique({ where: { id: clientId, companyId } })
    : await prisma.client.findFirst({ where: { companyId, isInternal: true } })

  if (!client) {
    throw new UserError("No client found to generate an Asset Tag from.")
  }
  if (!client.prefix) {
    throw new UserError(`${client.name} doesn't have a Company Prefix set yet. Add one before receiving hardware for this client.`)
  }

  // Atomic read-and-increment so two receipts happening at the same
  // moment can't ever be handed the same sequence number.
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { nextAssetSequence: { increment: 1 } },
    select: { nextAssetSequence: true },
  })
  const sequence = updated.nextAssetSequence - 1

  return `${client.prefix}-${String(sequence).padStart(4, "0")}`
}