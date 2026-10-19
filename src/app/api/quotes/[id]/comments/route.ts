import { NextRequest, NextResponse } from "next/server"
import { sendQuoteNotificationEmail } from "@/lib/send-quote-email"
import { prisma } from "@/lib/prisma"
import { escapeHtml, escapeHtmlWithBreaks } from "@/lib/html"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote, viewableQuoteWhere } from "@/lib/scoped-loaders"

export const runtime = "nodejs"
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

  const comments = await prisma.quoteComment.findMany({
    where: { quoteId: id },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(comments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const body = await req.json()
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 })
  }

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: {
      client: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!quote) return notFound()

  const comment = await prisma.quoteComment.create({
    data: {
      quoteId: id,
      authorType: "INTERNAL",
      authorUserId: ctx.userId,
      authorName: ctx.userName || "Team",
      message: body.message.trim(),
    },
  })

  // Notify the client that a new message is waiting for them — fire-and-forget
  // so a slow or failed email send never blocks the rep's comment from posting
  const clientEmail = quote.contact?.email
  if (clientEmail) {
    const portalLink = `${req.nextUrl.origin}/portal/${quote.accessToken}`
    sendQuoteNotificationEmail(
      id,
      clientEmail,
      `New message on Quote ${quote.quoteNumber}`,
      `<p>${escapeHtml(comment.authorName)} sent you a message on your quote:</p><blockquote>${escapeHtmlWithBreaks(body.message.trim())}</blockquote><p><a href="${escapeHtml(portalLink)}">View and reply</a></p>`
    ).catch((err) => console.error("Failed to send comment notification email:", err))
  }

  return NextResponse.json(comment)
}