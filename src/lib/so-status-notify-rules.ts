// CompanySettings.soStatusNotifyRules: for each sales order status that
// can send a notification, who to notify, a specific user or everyone
// holding a role. null (or a missing status) means no notification.

export const SO_NOTIFY_STATUSES = ["READY_TO_INVOICE", "READY_TO_ORDER", "READY_TO_CLOSEOUT"] as const

export type SoNotifyStatus = (typeof SO_NOTIFY_STATUSES)[number]

export interface SoStatusNotifyRule {
  type: "user" | "role"
  // Empty while the settings panel has a type picked but no one chosen yet
  id: string
}

export type SoStatusNotifyRules = Partial<Record<SoNotifyStatus, SoStatusNotifyRule | null>>

// Reads the rules from a request body, keeping only the known fields, plus
// the user and role ids they point at for the caller to check against the
// company. Returns null when the shape is wrong.
export function readSoStatusNotifyRules(
  value: unknown
): { rules: SoStatusNotifyRules; userIds: string[]; roleIds: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const rules: SoStatusNotifyRules = {}
  const userIds: string[] = []
  const roleIds: string[] = []

  for (const [status, rule] of Object.entries(value)) {
    if (!(SO_NOTIFY_STATUSES as readonly string[]).includes(status)) return null
    const key = status as SoNotifyStatus

    if (rule === null) {
      rules[key] = null
      continue
    }
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null
    const { type, id } = rule as { type?: unknown; id?: unknown }
    if ((type !== "user" && type !== "role") || typeof id !== "string") return null

    rules[key] = { type, id }
    if (id) (type === "user" ? userIds : roleIds).push(id)
  }

  return { rules, userIds, roleIds }
}
