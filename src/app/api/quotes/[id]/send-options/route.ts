import { NextRequest, NextResponse } from "next/server"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"
import { chooseQuoteSender, listCompanyMailboxes, loadSenderInput, type SenderMailbox } from "@/lib/quote-sender"

// The From choices for the Send Quote dialog. Someone without
// quotes.sendAsOthers only ever gets their default sender back. Never
// returns tokens or any other credential.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.sendEmail",
    message: "You do not have permission to send quotes",
  })
  if (response) return response

  const { id } = await params
  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  const input = await loadSenderInput(ctx, quote)
  const decision = chooseQuoteSender(input)
  const canChooseSender = input.canSendAsOthers

  const toOption = (m: SenderMailbox) => ({
    connectionId: m.id,
    email: m.email,
    ownerName: m.ownerName,
    isShared: m.id === input.sharedId,
  })

  const options = canChooseSender
    ? (await listCompanyMailboxes(ctx.companyId)).map(toOption)
    : decision.ok
      ? [toOption(decision.mailbox)]
      : []

  return NextResponse.json({
    defaultConnectionId: decision.ok ? decision.mailbox.id : null,
    // Why there is no default, e.g. the user still has to connect a mailbox
    defaultError: decision.ok ? null : decision.error,
    canChooseSender,
    options,
  })
}
