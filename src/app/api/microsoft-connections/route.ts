import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// Everyone sees their own mailboxes. Integrations and Quote Settings
// (which picks the shared sender) see every mailbox in the company. Never
// returns tokens.
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const seesAll = ctx.can("settingsSections.integrations") || ctx.can("settingsSections.quotes")

  const [connections, settings] = await Promise.all([
    prisma.microsoftConnection.findMany({
      where: seesAll ? { companyId: ctx.companyId } : { companyId: ctx.companyId, connectedByUserId: ctx.userId },
      select: {
        id: true,
        label: true,
        email: true,
        connectedByUserId: true,
        connectedByUser: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.companySettings.findUnique({
      where: { companyId: ctx.companyId },
      select: { quoteSendFromConnectionId: true },
    }),
  ])

  // isSharedSender lets the Microsoft panel hide Disconnect on the mailbox
  // every quote is sent from, which only Integrations may remove
  return NextResponse.json(
    connections.map((c) => ({ ...c, isSharedSender: c.id === settings?.quoteSendFromConnectionId }))
  )
}
