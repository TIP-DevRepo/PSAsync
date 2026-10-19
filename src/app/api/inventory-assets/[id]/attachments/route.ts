import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadInventoryAsset } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "inventory",
    message: "You do not have permission to view inventory",
  })
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
  const { ctx, response } = await requireAccess({
    page: "inventory",
    message: "You do not have permission to edit inventory",
  })
  if (response) return response

  const { id } = await params
  const asset = await loadInventoryAsset(ctx, id)
  if (!asset) return notFound()

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `inventory-assets/${asset.id}`, profile: "ATTACHMENT" })

  const attachment = await prisma.inventoryAssetAttachment.create({
    data: {
      assetId: asset.id,
      fileName: file.displayName,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
