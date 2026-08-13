import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { uploadFileToS3 } from "@/lib/s3"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const logoUrl = await uploadFileToS3(buffer, file.name, file.type, `vendors/${id}/logo`)

  const updated = await prisma.vendor.update({
    where: { id },
    data: { logoUrl },
  })

  return NextResponse.json({ logoUrl: updated.logoUrl })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  await prisma.vendor.update({
    where: { id },
    data: { logoUrl: null },
  })

  return NextResponse.json({ deleted: true })
}