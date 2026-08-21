import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { uploadFileToS3 } from "@/lib/s3"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const attachments = await prisma.inventoryAssetAttachment.findMany({
    where: { assetId: id },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(attachments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileUrl = await uploadFileToS3(buffer, file.name, file.type, `inventory-assets/${id}`)

  const attachment = await prisma.inventoryAssetAttachment.create({
    data: {
      assetId: id,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: session.user.id,
    },
  })

  return NextResponse.json(attachment)
}