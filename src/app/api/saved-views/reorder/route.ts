import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import { isSameIdList } from "@/lib/ticket-rules"
import { readIdList } from "@/lib/teams"
import { isSavedViewPage, SAVED_VIEW_MESSAGES, SAVED_VIEW_PAGES, SAVED_VIEW_PERMISSIONS } from "@/lib/saved-views"
import { userFacingError } from "@/lib/user-error"
import { SAVED_VIEW_ORDER, savedViewSelect } from "@/lib/saved-view-selects"

// { page, viewIds }: every one of the user's views for the page, in the new
// order. A list that isn't exactly their views (one added or removed
// meanwhile, or someone else's id) is a 409 and changes nothing.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({ permission: SAVED_VIEW_PERMISSIONS, message: "You do not have permission to use saved views" })
  if (response) return response

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  if (!isSavedViewPage(body.page)) return apiError(400, SAVED_VIEW_MESSAGES.page)
  const page = body.page
  if (!ctx.can(SAVED_VIEW_PAGES[page].permission)) return apiError(403, "You do not have permission to use saved views on this page", "FORBIDDEN")
  const ids = readIdList(body.viewIds)
  if (!ids) return apiError(400, SAVED_VIEW_MESSAGES.order)

  const where = { companyId: ctx.companyId, userId: ctx.userId, page }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.savedView.findMany({ where, select: { id: true } })
      if (!isSameIdList(ids, current.map((v) => v.id))) return null
      // One after another: a transaction runs one query at a time
      for (const [index, id] of ids.entries()) {
        await tx.savedView.updateMany({ where: { ...where, id }, data: { sortOrder: index } })
      }
      return tx.savedView.findMany({ where, select: savedViewSelect, orderBy: SAVED_VIEW_ORDER })
    })
    if (!result) return apiError(409, SAVED_VIEW_MESSAGES.orderStale, "VIEW_LIST_CHANGED")
    return NextResponse.json(result)
  } catch (err) {
    const { message, status } = userFacingError(err, "Reordering views")
    return apiError(status, message)
  }
}
