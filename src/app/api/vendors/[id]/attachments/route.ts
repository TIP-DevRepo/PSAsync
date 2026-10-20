import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendor } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to view vendors",
  })
  if (response) return response

  const { id } = await params
  const vendor = await loadVendor(ctx, id)
  if (!vendor) return notFound()

  const attachments = await prisma.vendorAttachment.findMany({
    where: { vendorId: vendor.id, vendor: { companyId: ctx.companyId } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(attachments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to edit vendors",
  })
  if (response) return response

  const { id } = await params
  const vendor = await loadVendor(ctx, id)
  if (!vendor) return notFound()

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `vendors/${vendor.id}`, profile: "ATTACHMENT" })

  const attachment = await prisma.vendorAttachment.create({
    data: {
      vendorId: vendor.id,
      fileName: file.displayName,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
