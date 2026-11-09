import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, savedViewWhere } from "@/lib/scoped-loaders"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import { isSavedViewPage, readViewName, SAVED_VIEW_MESSAGES, SAVED_VIEW_PAGES, SAVED_VIEW_PERMISSIONS } from "@/lib/saved-views"
import { savedViewSelect } from "@/lib/saved-view-selects"
import type { Prisma } from "@/generated/prisma"

const RULE = { permission: SAVED_VIEW_PERMISSIONS, message: "You do not have permission to use saved views" }

// The user's own view on its page, or null (another user's, another
// company's, or a page the user can no longer open)
async function loadOwnView(ctx: Parameters<typeof savedViewWhere>[0] & { can: (p: string) => boolean }, id: string) {
  const view = await prisma.savedView.findFirst({ where: savedViewWhere(ctx, id), select: { id: true, page: true } })
  if (!view || !isSavedViewPage(view.page) || !ctx.can(SAVED_VIEW_PAGES[view.page].permission)) return null
  return { id: view.id, page: view.page }
}

// Renames the view (name) or replaces what it holds (params, checked like
// a new view's). Another user's view is a 404.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const { id } = await params
  const view = await loadOwnView(ctx, id)
  if (!view) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: Prisma.SavedViewUpdateInput = {}
  if ("name" in body) {
    const name = readViewName(body.name)
    if (name.error !== undefined) return apiError(400, name.error)
    data.name = name.value
  }
  if ("params" in body) {
    const checked = SAVED_VIEW_PAGES[view.page].readParams(body.params)
    if (checked.error !== undefined) return apiError(400, checked.error)
    const invalid = await assertRefs(ctx, checked.refs)
    if (invalid) return invalid
    data.params = checked.value as Prisma.InputJsonObject
  }

  try {
    const saved = await prisma.savedView.update({ where: savedViewWhere(ctx, view.id), data, select: savedViewSelect })
    return NextResponse.json(saved)
  } catch (err) {
    if (isPrismaError(err, "P2002")) return apiError(409, SAVED_VIEW_MESSAGES.nameTaken, "NAME_TAKEN")
    if (isPrismaError(err, "P2025")) return notFound()
    const { message, status } = userFacingError(err, "Changing a view")
    return apiError(status, message)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const { id } = await params
  const view = await loadOwnView(ctx, id)
  if (!view) return notFound()

  const { count } = await prisma.savedView.deleteMany({ where: savedViewWhere(ctx, view.id) })
  if (count === 0) return notFound()
  return NextResponse.json({ deleted: true })
}
