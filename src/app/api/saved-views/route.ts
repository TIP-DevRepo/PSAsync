import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import {
  isSavedViewPage,
  readViewName,
  SAVED_VIEW_MESSAGES,
  SAVED_VIEW_PAGES,
  SAVED_VIEW_PERMISSIONS,
  SAVED_VIEWS_PER_PAGE_MAX,
} from "@/lib/saved-views"
import { SAVED_VIEW_ORDER, savedViewSelect } from "@/lib/saved-view-selects"
import type { Prisma } from "@/generated/prisma"

// A user's own saved views (src/lib/saved-views.ts). Every view belongs to
// the signed in user; nobody else's is ever listed or changed. The any-of
// rule opens the routes to anyone who can open a page with saved views;
// each request then needs its own page's permission.

const RULE = { permission: SAVED_VIEW_PERMISSIONS, message: "You do not have permission to use saved views" }

// ?page=tickets: the user's views for that page, in their order
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const page = req.nextUrl.searchParams.get("page")
  if (!isSavedViewPage(page)) return apiError(400, SAVED_VIEW_MESSAGES.page)
  if (!ctx.can(SAVED_VIEW_PAGES[page].permission)) return apiError(403, "You do not have permission to use saved views on this page", "FORBIDDEN")

  const views = await prisma.savedView.findMany({
    where: { companyId: ctx.companyId, userId: ctx.userId, page },
    select: savedViewSelect,
    orderBy: SAVED_VIEW_ORDER,
  })
  return NextResponse.json(views)
}

// Saves a new view at the end of the user's list: { page, name, params }.
// params is checked against the page's allowed filters, and the ids it
// names (a queue, an assignee) must be the company's.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  if (!isSavedViewPage(body.page)) return apiError(400, SAVED_VIEW_MESSAGES.page)
  const page = body.page
  const rule = SAVED_VIEW_PAGES[page]
  if (!ctx.can(rule.permission)) return apiError(403, "You do not have permission to use saved views on this page", "FORBIDDEN")

  const name = readViewName(body.name)
  if (name.error !== undefined) return apiError(400, name.error)
  const params = rule.readParams(body.params)
  if (params.error !== undefined) return apiError(400, params.error)
  const invalid = await assertRefs(ctx, params.refs)
  if (invalid) return invalid

  const where = { companyId: ctx.companyId, userId: ctx.userId, page }
  const count = await prisma.savedView.count({ where })
  if (count >= SAVED_VIEWS_PER_PAGE_MAX) return apiError(400, SAVED_VIEW_MESSAGES.tooMany)
  const last = await prisma.savedView.findFirst({ where, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })

  try {
    const view = await prisma.savedView.create({
      data: { ...where, name: name.value, params: params.value as Prisma.InputJsonObject, sortOrder: (last?.sortOrder ?? -1) + 1 },
      select: savedViewSelect,
    })
    return NextResponse.json(view)
  } catch (err) {
    if (isPrismaError(err, "P2002")) return apiError(409, SAVED_VIEW_MESSAGES.nameTaken, "NAME_TAKEN")
    const { message, status } = userFacingError(err, "Saving a view")
    return apiError(status, message)
  }
}
