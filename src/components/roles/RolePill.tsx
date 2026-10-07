import type { CSSProperties } from "react"
import { Lock } from "lucide-react"
import { roleDisplayColor } from "@/lib/role-colors"

export interface RolePillRole {
  name: string
  color?: string | null
  isGlobalAdmin?: boolean
  isEveryone?: boolean
}

// A role's name as a tinted pill in the role's color (see .role-pill in
// globals.css). Global Admin and Everyone always use their fixed colors,
// and a role with no color falls back to neutral gray. locked adds a lock
// icon, for pills that can't be removed (like Everyone on a user). Names are
// never truncated: a pill moves to its own line first, and only a name too
// long for the whole container wraps inside the pill.
export function RolePill({ role, locked = false }: { role: RolePillRole; locked?: boolean }) {
  return (
    <span
      className="role-pill inline-flex max-w-full items-center gap-1 rounded-xl border px-2 py-0.5 text-caption font-medium"
      style={{ "--role-color": roleDisplayColor(role) } as CSSProperties}
    >
      {locked && <Lock size={10} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0 break-words">{role.name}</span>
      {locked && <span className="sr-only">(locked)</span>}
    </span>
  )
}
