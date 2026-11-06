import { compareUserNames } from "@/lib/user-picker"

// Round robin for a team (Team.roundRobinEnabled): a new ticket created
// unassigned in the team goes to the next active member after the last one
// it gave a ticket to (Team.roundRobinLastUserId). The members go round in
// the shared user picker order (compareUserNames: by name ignoring case,
// then id), so the order is stable and the same one people see. Inactive
// members are skipped, and when the last one has left the team the next
// member after where they would sort takes it. No database imports.

export interface RoundRobinMember {
  id: string
  name: string
  active: boolean
}

// The member to assign, or null when the team has no active member
export function nextRoundRobinAssignee(members: readonly RoundRobinMember[], last: { id: string; name: string } | null): string | null {
  const sorted = [...members].sort(compareUserNames)
  const active = sorted.filter((m) => m.active)
  if (active.length === 0) return null
  if (!last) return active[0].id
  const after = active.find((m) => compareUserNames(m, last) > 0)
  return (after ?? active[0]).id
}
