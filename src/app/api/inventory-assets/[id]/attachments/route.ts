import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { uploadFileToS3 } from "@/lib/s3"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadInventoryAsset } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const asset = await loadInventoryAsset(ctx, id)
  if (!asset) return notFound()

  const attachments = await prisma.inventoryAssetAttachment.findMany({
    where: { assetId: asset.id, asset: { companyId: ctx.companyId } },
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
  const asset = await loadInventoryAsset(ctx, id)
  if (!asset) return notFound()

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileUrl = await uploadFileToS3(buffer, file.name, file.type, `inventory-assets/${asset.id}`)

  const attachment = await prisma.inventoryAssetAttachment.create({
    data: {
      assetId: asset.id,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
