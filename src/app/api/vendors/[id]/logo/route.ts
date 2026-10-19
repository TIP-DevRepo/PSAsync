import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { deleteStoredObject, readUploadFromRequest, storeUpload } from "@/lib/uploads"

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

  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { id: true, logoUrl: true },
  })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  // PNG, JPG, or WebP up to 2 MB, checked by content
  const { file, response: rejected } = await readUploadFromRequest(req, "LOGO")
  if (rejected) return rejected

  const logoUrl = await storeUpload(file, { folder: `vendors/${vendor.id}/logo`, profile: "LOGO" })

  const updated = await prisma.vendor.update({
    where: { id },
    data: { logoUrl },
  })

  // The replaced logo's file, best effort once the new one is saved
  if (vendor.logoUrl && vendor.logoUrl !== logoUrl) {
    await deleteStoredObject(vendor.logoUrl, `vendors/${vendor.id}/logo/`)
  }

  return NextResponse.json({ logoUrl: updated.logoUrl })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to edit vendors",
  })
  if (response) return response

  const { id } = await params

  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { id: true, logoUrl: true },
  })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  await prisma.vendor.update({
    where: { id },
    data: { logoUrl: null },
  })

  // Best effort once the logo is cleared
  await deleteStoredObject(vendor.logoUrl, `vendors/${vendor.id}/logo/`)

  return NextResponse.json({ deleted: true })
}