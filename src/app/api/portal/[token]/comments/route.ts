import { NextRequest, NextResponse } from "next/server"
import { notifyQuoteComment } from "@/lib/notify"
import { linkInvalidResponse, resolvePortalAccess } from "@/lib/portal-access"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Staff may read the thread in the internal preview
  const access = await resolvePortalAccess(token, "view", { allowInternal: true })
  if (!access.ok) return access.response
  const activeId = access.quoteId

  const comments = await prisma.quoteComment.findMany({
    where: { quoteId: activeId },
    orderBy: { createdAt: "asc" },
    select: { id: true, authorType: true, authorName: true, message: true, createdAt: true },
  })

  return NextResponse.json(comments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Only while the quote is waiting on the customer and not expired
  const access = await resolvePortalAccess(token, "act")
  if (!access.ok) return access.response
  const activeId = access.quoteId

  const body = await req.json().catch(() => ({}))
  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 })
  }

  const quote = await prisma.quote.findUnique({
    where: { id: activeId },
    include: {
      contact: { select: { firstName: true, lastName: true } },
      client: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  })
  if (!quote) return linkInvalidResponse()

  const authorName = quote.contact
    ? `${quote.contact.firstName} ${quote.contact.lastName}`
    : quote.client.name

  const comment = await prisma.quoteComment.create({
    data: {
      quoteId: activeId,
      authorType: "CLIENT",
      authorName,
      message: body.message.trim(),
    },
  })

  // Notify the rep that the client replied — fire-and-forget so a slow or
  // failed notification never blocks the client's comment from saving
  notifyQuoteComment(activeId, authorName, body.message.trim()).catch((err) =>
    console.error("notifyQuoteComment failed:", err)
  )

  return NextResponse.json({
    id: comment.id,
    authorType: comment.authorType,
    authorName: comment.authorName,
    message: comment.message,
    createdAt: comment.createdAt,
  })
}