// The zod schemas for sidebar layouts (src/lib/sidebar-layout.ts): one strict
// schema for what a request may send (PATCH /api/company-settings/sidebar
// and PATCH /api/account/sidebar), and one lenient schema for what the
// database holds, so a stored layout with a part this release doesn't
// understand loses only that part. Both end in normalizeSidebarLayout, so
// unknown sections and pages are dropped and each key appears once.

import { z } from "zod"
import { TICKET_VIEWS } from "@/lib/ticket-list"
import { normalizeSidebarLayout, OPPORTUNITY_DEFAULT_VIEWS, type SidebarLayout } from "@/lib/sidebar-layout"

// Generous limits: the real lists are a dozen pages and a handful of teams
export const SIDEBAR_MAX_SECTIONS = 20
export const SIDEBAR_MAX_ITEMS = 50
export const SIDEBAR_MAX_TEAMS = 200

const itemKey = z.string().min(1).max(64)
// A cuid like id, the same shape the list pages accept from the URL
const teamId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid team")

const folderInput = z.object({
  teamOrder: z.array(teamId).max(SIDEBAR_MAX_TEAMS).optional(),
  openByDefault: z.boolean().optional(),
})

export const sidebarLayoutInput = z.object({
  sections: z
    .record(itemKey, z.array(itemKey).max(SIDEBAR_MAX_ITEMS))
    .refine((sections) => Object.keys(sections).length <= SIDEBAR_MAX_SECTIONS, "Too many sections")
    .optional(),
  folders: z
    .object({
      tickets: folderInput.optional(),
      opportunities: folderInput.optional(),
    })
    .optional(),
  defaultViews: z
    .object({
      opportunities: z.enum(OPPORTUNITY_DEFAULT_VIEWS).optional(),
      tickets: z.enum(TICKET_VIEWS).optional(),
    })
    .optional(),
})

export const INVALID_LAYOUT_MESSAGE = "Invalid sidebar layout"
export const INVALID_VIEW_MESSAGE = "Choose a default view from the list"
export const INVALID_ALLOW_MESSAGE = "Let users customise their sidebar must be true or false"

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

const isObject = (body: unknown): body is Record<string, unknown> => typeof body === "object" && body !== null && !Array.isArray(body)

function readLayout(value: unknown): Result<SidebarLayout> {
  const parsed = sidebarLayoutInput.safeParse(value)
  if (!parsed.success) {
    const onView = parsed.error.issues.some((issue) => issue.path[0] === "defaultViews")
    return { error: onView ? INVALID_VIEW_MESSAGE : INVALID_LAYOUT_MESSAGE }
  }
  return { data: normalizeSidebarLayout(parsed.data) }
}

// PATCH /api/account/sidebar: { layout }, the whole layout
export function readUserSidebarPatch(body: unknown): Result<{ layout: SidebarLayout }> {
  if (!isObject(body) || !("layout" in body)) return { error: INVALID_LAYOUT_MESSAGE }
  const layout = readLayout(body.layout)
  if (layout.error !== undefined) return layout
  return { data: { layout: layout.data } }
}

// PATCH /api/company-settings/sidebar: { layout?, allowUserSidebar? }; a
// part left out is kept
export function readCompanySidebarPatch(body: unknown): Result<{ layout?: SidebarLayout; allowUserSidebar?: boolean }> {
  if (!isObject(body)) return { error: INVALID_LAYOUT_MESSAGE }
  const data: { layout?: SidebarLayout; allowUserSidebar?: boolean } = {}
  if ("layout" in body) {
    const layout = readLayout(body.layout)
    if (layout.error !== undefined) return layout
    data.layout = layout.data
  }
  if ("allowUserSidebar" in body) {
    if (typeof body.allowUserSidebar !== "boolean") return { error: INVALID_ALLOW_MESSAGE }
    data.allowUserSidebar = body.allowUserSidebar
  }
  return { data }
}

// ─── Stored layouts ─────────────────────────────────────────────────────────

// Strings only, anything else in the list dropped
const storedStrings = z
  .array(z.unknown())
  .transform((values) => values.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))

const storedFolder = z.object({
  teamOrder: storedStrings.optional().catch(undefined),
  openByDefault: z.boolean().optional().catch(undefined),
})

const storedLayout = z.object({
  sections: z.record(z.string(), storedStrings.catch([])).optional().catch(undefined),
  folders: z
    .object({
      tickets: storedFolder.optional().catch(undefined),
      opportunities: storedFolder.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  defaultViews: z
    .object({
      opportunities: z.enum(OPPORTUNITY_DEFAULT_VIEWS).optional().catch(undefined),
      tickets: z.enum(TICKET_VIEWS).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
})

// A stored layout (Json from the database) as a layout, or null when there
// is none or it isn't an object at all. Never throws.
export function parseStoredSidebarLayout(value: unknown): SidebarLayout | null {
  if (value === null || value === undefined) return null
  const parsed = storedLayout.safeParse(value)
  if (!parsed.success) return null
  return normalizeSidebarLayout(parsed.data)
}
