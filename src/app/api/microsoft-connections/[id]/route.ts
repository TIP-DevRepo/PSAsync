import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"

// Anyone may disconnect their own mailbox. Someone else's, or the mailbox
// Quote Settings sends every quote from, needs Integrations access.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const existing = await prisma.microsoftConnection.findFirst({
    where: { id, companyId: ctx.companyId },
    select: { id: true, connectedByUserId: true },
  })
  if (!existing) return notFound()

  if (!ctx.can("settingsSections.integrations")) {
    // Someone else's mailbox stays hidden, same as in the list
    if (existing.connectedByUserId !== ctx.userId) return notFound()

    const settings = await prisma.companySettings.findUnique({
      where: { companyId: ctx.companyId },
      select: { quoteSendFromConnectionId: true },
    })
    if (settings?.quoteSendFromConnectionId === existing.id) {
      return apiError(
        403,
        "This mailbox is the shared quote sender. Someone with Integrations access has to disconnect it.",
        "FORBIDDEN"
      )
    }
  }

  await prisma.microsoftConnection.delete({ where: { id: existing.id, companyId: ctx.companyId } })

  return NextResponse.json({ deleted: true })
}
