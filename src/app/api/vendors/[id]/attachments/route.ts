import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { uploadFileToS3 } from "@/lib/s3"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendor } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
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
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const vendor = await loadVendor(ctx, id)
  if (!vendor) return notFound()

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileUrl = await uploadFileToS3(buffer, file.name, file.type, `vendors/${vendor.id}`)

  const attachment = await prisma.vendorAttachment.create({
    data: {
      vendorId: vendor.id,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
