import { NextRequest, NextResponse } from "next/server"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"
import { senderOptionsFor } from "@/lib/quote-sender"

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

  return NextResponse.json(await senderOptionsFor(ctx, quote))
}
