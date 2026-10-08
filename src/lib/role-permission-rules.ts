import { checkAccess, type EffectiveAccess, type RolePermissions } from "@/lib/permissions"

// Every key a role's permissions JSON may hold, matching RolePermissions,
// the Roles & Permissions panel, and the default role shapes. A permission
// added later must be listed here too, or saving a role that has it is
// rejected as unknown.
const BOOLEAN_SECTIONS: Record<string, readonly string[]> = {
  pages: ["clients", "catalog", "vendors", "inventory", "quotes", "settings", "salesOrders", "purchaseOrders"],
  quotes: ["create", "edit", "delete", "changeStatus", "approve", "sendEmail", "viewAllUsersQuotes"],
  clients: ["create", "edit", "delete", "viewAllClients"],
  salesOrders: ["create", "edit", "delete", "changeStatus", "generatePO", "viewAll"],
  purchaseOrders: ["create", "edit", "delete", "changeStatus", "send", "viewAll"],
  catalog: ["delete"],
  inventory: ["delete"],
  settingsSections: ["company", "users", "quotes", "approvalWorkflows", "notifications", "integrations", "salesOrders"],
  dashboards: ["manage"],
}

// Top level numbers, e.g. maxDiscount (a percentage)
const NUMERIC_KEYS: Record<string, { min: number; max: number }> = {
  maxDiscount: { min: 0, max: 100 },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

// Checks a permissions JSON from a request body against the known
// structure. Sections and keys may be left out, but nothing unknown or of
// the wrong type is accepted.
export function validateRolePermissions(
  input: unknown
): { permissions: RolePermissions; error?: undefined } | { error: string; permissions?: undefined } {
  if (!isPlainObject(input)) {
    return { error: "Permissions must be an object" }
  }

  for (const [key, value] of Object.entries(input)) {
    const numeric = NUMERIC_KEYS[key]
    if (numeric) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < numeric.min || value > numeric.max) {
        return { error: `Permission "${key}" must be a number from ${numeric.min} to ${numeric.max}` }
      }
      continue
    }

    const allowed = BOOLEAN_SECTIONS[key]
    if (!allowed) {
      return { error: `Unknown permission section "${key}"` }
    }
    if (!isPlainObject(value)) {
      return { error: `Permission section "${key}" must be an object` }
    }
    for (const [subKey, subValue] of Object.entries(value)) {
      if (!allowed.includes(subKey)) {
        return { error: `Unknown permission "${key}.${subKey}"` }
      }
      if (typeof subValue !== "boolean") {
        return { error: `Permission "${key}.${subKey}" must be true or false` }
      }
    }
  }

  return { permissions: input as RolePermissions }
}

// Permissions a save would newly turn on (or raise) that the actor doesn't
// hold themselves. Leaving a permission as it is, or turning one off, is
// always allowed. A number may be raised only up to the actor's own
// effective value. Global Admin holds everything, so is never refused.
export function findPermissionEscalations(
  actor: EffectiveAccess,
  current: unknown,
  next: RolePermissions
): string[] {
  if (actor.isGlobalAdmin) return []

  const currentObj = isPlainObject(current) ? current : {}
  const nextObj = next as Record<string, unknown>
  const actorObj = actor.permissions as Record<string, unknown>
  const refused: string[] = []

  for (const [key, value] of Object.entries(nextObj)) {
    if (NUMERIC_KEYS[key]) {
      const nextValue = value as number
      const currentValue = typeof currentObj[key] === "number" ? (currentObj[key] as number) : -Infinity
      const actorValue = typeof actorObj[key] === "number" ? (actorObj[key] as number) : 0
      if (nextValue > currentValue && nextValue > actorValue) {
        refused.push(`${key} above ${actorValue}`)
      }
      continue
    }

    const currentSection = isPlainObject(currentObj[key]) ? (currentObj[key] as Record<string, unknown>) : {}
    for (const [subKey, subValue] of Object.entries(value as Record<string, boolean>)) {
      const path = `${key}.${subKey}`
      if (subValue === true && currentSection[subKey] !== true && !checkAccess(actor, path)) {
        refused.push(path)
      }
    }
  }

  return refused
}
