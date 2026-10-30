import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableOpportunity } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { ownSenderOptions } from "@/lib/quote-sender"
import { EMAIL_ATTACHMENTS_MAX_BYTES } from "@/lib/microsoft-mail"

// What the Email action's composer needs: the From choices and default
// (the Send Quote rule with the user as the owner: the shared mailbox when
// Quote Settings names one, otherwise their own, others only with
// quotes.sendAsOthers), the company signature added under the message, the
// attachment size limit, and the client's contacts that have an email
// address, to pick recipients from. Never returns tokens or credentials.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const [sender, settings, record] = await Promise.all([
    ownSenderOptions(ctx),
    prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { emailSignature: true } }),
    prisma.opportunity.findFirst({
      where: { id: opportunity.id, companyId: ctx.companyId },
      select: {
        client: {
          select: {
            contacts: {
              where: { email: { not: null } },
              select: { id: true, firstName: true, lastName: true, email: true },
              orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            },
          },
        },
      },
    }),
  ])

  return NextResponse.json({
    ...sender,
    signature: settings?.emailSignature?.trim() || null,
    maxAttachmentBytes: EMAIL_ATTACHMENTS_MAX_BYTES,
    contacts: (record?.client.contacts ?? [])
      .filter((c) => !!c.email)
      .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email as string })),
  })
}
