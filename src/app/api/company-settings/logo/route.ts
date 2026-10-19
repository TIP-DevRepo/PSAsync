import { NextRequest, NextResponse } from "next/server"
import { readUpload, storeUpload } from "@/lib/uploads"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"

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

  await prisma.company.update({
    where: { id: ctx.companyId },
    data: slot === "secondary" ? { secondaryLogoUrl: logoUrl } : { logoUrl },
  })

  return NextResponse.json({ logoUrl, slot })
}
