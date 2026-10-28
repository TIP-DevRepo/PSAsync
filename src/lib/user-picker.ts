// The one ordering and labeling rule for every place a user is chosen or
// filtered by user: every user, the current user included, shows by their
// own full name (never "Me"), sorted alphabetically ignoring case, with
// "Unassigned" first wherever unassigned is allowed. Only labels and order:
// who is in the list stays the caller's decision. No React and no database
// imports, so pages and components can all use it.

export const UNASSIGNED_LABEL = "Unassigned"

export interface PickerUser {
  id: string
  name: string
}

export interface UserChoice {
  value: string
  label: string
}

// Alphabetical by full name, case insensitive (and accent insensitive);
// equal names keep a stable order by id
export function compareUserNames(a: PickerUser, b: PickerUser): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// A sorted copy; the list passed in is left as it was
export function sortUsersByName<T extends PickerUser>(users: readonly T[]): T[] {
  return [...users].sort(compareUserNames)
}

// The options for a user select: "Unassigned" first when allowed (with the
// value that means unassigned, "" unless given), then every user by name.
// valueFor lets a list keep a special value for a user (the owner filter's
// "me", for example) while still showing the name.
export function userChoices<T extends PickerUser>(
  users: readonly T[],
  opts: { unassignedValue?: string; valueFor?: (user: T) => string } = {}
): UserChoice[] {
  const choices = sortUsersByName(users).map((u) => ({ value: opts.valueFor ? opts.valueFor(u) : u.id, label: u.name }))
  return opts.unassignedValue === undefined ? choices : [{ value: opts.unassignedValue, label: UNASSIGNED_LABEL }, ...choices]
}
