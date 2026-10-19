import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadViewableSalesOrder } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.salesOrders",
    message: "You do not have permission to view sales orders",
  })
  if (response) return response

  const { id } = await params
  const order = await loadViewableSalesOrder(ctx, id)
  if (!order) return notFound()

  const attachments = await prisma.sOAttachment.findMany({
    where: { salesOrderId: order.id, salesOrder: { companyId: ctx.companyId } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(attachments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "salesOrders.edit",
    message: "You do not have permission to edit sales orders",
  })
  if (response) return response

  const { id } = await params
  const order = await loadViewableSalesOrder(ctx, id)
  if (!order) return notFound()

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `sales-orders/${order.id}`, profile: "ATTACHMENT" })

  const attachment = await prisma.sOAttachment.create({
    data: {
      salesOrderId: order.id,
      fileName: file.displayName,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
