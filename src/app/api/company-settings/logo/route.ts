import { NextRequest, NextResponse } from "next/server"
import { deleteStoredObject, readUpload, storeUpload } from "@/lib/uploads"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { isLogoSlot, logoFileToDelete } from "@/lib/company-logo"

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.company",
    message: "You do not have permission to change the company logo",
  })
  if (response) return response

  const formData = await req.formData().catch(() => null)
  if (!formData) return apiError(400, "No file provided")
  // "primary" (default) or "secondary" — which logo slot this upload fills
  const slot = (formData.get("slot") as string | null) === "secondary" ? "secondary" : "primary"

  // PNG, JPG, or WebP up to 2 MB, checked by content. Stored in the same
  // flat logos folder as before, so the bucket policy for it still applies.
  const { file, response: rejected } = await readUpload(formData, "LOGO")
  if (rejected) return rejected

  const logoUrl = await storeUpload(file, { folder: "logos", profile: "LOGO", namePrefix: `${ctx.companyId}-` })

  const before = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: { logoUrl: true, secondaryLogoUrl: true },
  })

  await prisma.company.update({
    where: { id: ctx.companyId },
    data: slot === "secondary" ? { secondaryLogoUrl: logoUrl } : { logoUrl },
  })

  // The replaced logo's file, best effort once the new one is saved. Kept
  // when the other slot still shows the same file.
  const replaced = slot === "secondary" ? before?.secondaryLogoUrl : before?.logoUrl
  const otherSlot = slot === "secondary" ? before?.logoUrl : before?.secondaryLogoUrl
  if (replaced && replaced !== logoUrl && replaced !== otherSlot) {
    await deleteStoredObject(replaced, "logos/")
  }

  return NextResponse.json({ logoUrl, slot })
}

// Removes one logo (?slot=primary or secondary), with the same permission
// as uploading: the slot is set to null, then its stored file is deleted
// (best effort, after the write; a link outside the bucket's logos folder
// is skipped, and a file the other slot still shows is kept). Nothing else
// is recorded. Every place that showed it falls back (src/lib/company-
// logo.ts).
export async function DELETE(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.company",
    message: "You do not have permission to change the company logo",
  })
  if (response) return response

  const slot = req.nextUrl.searchParams.get("slot") ?? "primary"
  if (!isLogoSlot(slot)) return apiError(400, "Invalid logo slot")

  const before = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: { logoUrl: true, secondaryLogoUrl: true },
  })
  if (!before) return apiError(404, "Not found")

  await prisma.company.update({
    where: { id: ctx.companyId },
    data: slot === "secondary" ? { secondaryLogoUrl: null } : { logoUrl: null },
  })

  const file = logoFileToDelete(before, slot)
  if (file) await deleteStoredObject(file, "logos/")

  return NextResponse.json({ logoUrl: null, slot })
}
