import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadCatalogItem } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const catalogItem = await loadCatalogItem(ctx, id)
  if (!catalogItem) return notFound()

  const logs = await prisma.catalogItemChangeLog.findMany({
    where: { catalogItemId: catalogItem.id, catalogItem: { companyId: ctx.companyId } },
    include: { changedByUser: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(logs)
}
