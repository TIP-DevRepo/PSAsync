import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { checkAccess, type EffectiveAccess, type RolePermissions } from "@/lib/permissions"

// The one JSON error shape every API route returns
export interface ApiError {
  error: string
  code?: string
}

export function apiError(status: number, error: string, code?: string) {
  const body: ApiError = code ? { error, code } : { error }
  return NextResponse.json(body, { status })
}

// Used for every record that's missing or belongs to another company, so a
// response never reveals that an id exists somewhere else
export function notFound() {
  return apiError(404, "Not found")
}

// What a route requires beyond a signed in, active user. Every field is
// optional and all given fields must pass. permission takes a dot path like
// "quotes.delete", or a list where holding any one is enough.
export interface AccessRule {
  permission?: string | string[]
  page?: keyof NonNullable<RolePermissions["pages"]>
  settingsSection?: keyof NonNullable<RolePermissions["settingsSections"]>
  minRank?: number
  globalAdmin?: boolean
  // Only for the routes the forced password change screen needs. Everything
  // else refuses a user still on an admin's temporary password.
  allowPasswordGate?: boolean
}

export interface AccessContext {
  userId: string
  // From the user's database row, never the login token
  companyId: string
  // Display name from the session, for things like comment author names
  userName: string | null
  access: EffectiveAccess
  can: (path: string) => boolean
}

export type AccessResult =
  | { ctx: AccessContext; response?: undefined }
  | { response: NextResponse; ctx?: undefined }

// Start of every API route handler:
//   const { ctx, response } = await requireAccess()
//   if (response) return response
// Access comes from the session callback in src/auth.ts, which resolves it
// with getEffectiveAccess on this same auth() call, so this adds no query.
export async function requireAccess(rule: AccessRule = {}): Promise<AccessResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { response: apiError(401, "Not authenticated") }
  }

  // Null for a deactivated or deleted user
  const access = session.user.access
  if (!access) {
    return { response: apiError(401, "Not authenticated") }
  }

  if (access.mustChangePassword && !rule.allowPasswordGate) {
    return {
      response: apiError(403, "You need to change your password before continuing", "PASSWORD_CHANGE_REQUIRED"),
    }
  }

  const can = (path: string) => checkAccess(access, path)

  const permissions = rule.permission === undefined ? [] : [rule.permission].flat()
  const refused =
    (rule.globalAdmin && !access.isGlobalAdmin) ||
    (rule.minRank !== undefined && access.rank < rule.minRank) ||
    (rule.page !== undefined && !can(`pages.${rule.page}`)) ||
    (rule.settingsSection !== undefined && !can(`settingsSections.${rule.settingsSection}`)) ||
    (permissions.length > 0 && !permissions.some((p) => can(p)))
  if (refused) {
    return { response: apiError(403, "You don't have permission to do this", "FORBIDDEN") }
  }

  return {
    ctx: {
      userId: access.userId,
      companyId: access.companyId,
      userName: session.user.name ?? null,
      access,
      can,
    },
  }
}
