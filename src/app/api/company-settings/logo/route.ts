import { NextRequest, NextResponse } from "next/server"
import { uploadFileToS3 } from "@/lib/s3"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.company",
    message: "You do not have permission to change the company logo",
  })
  if (response) return response

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  // "primary" (default) or "secondary" — which logo slot this upload fills
  const slot = (formData.get("slot") as string | null) === "secondary" ? "secondary" : "primary"

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const logoUrl = await uploadFileToS3(buffer, file.name, file.type)

  await prisma.company.update({
    where: { id: ctx.companyId },
    data: slot === "secondary" ? { secondaryLogoUrl: logoUrl } : { logoUrl },
  })

  return NextResponse.json({ logoUrl, slot })
}
