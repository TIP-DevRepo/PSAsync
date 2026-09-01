export interface LocationOption {
  id: string
  name: string
  parentId: string | null
}

export interface LocationPathOption {
  id: string
  label: string
}

// Turns a flat list of InventoryLocation records into "Parent > Child"
// style labels for use in a single-level dropdown, since a location's
// short name alone (e.g. "Shelf 1") can exist under multiple parents.
export function buildLocationPathOptions(locations: LocationOption[]): LocationPathOption[] {
  const byId = new Map(locations.map((l) => [l.id, l]))

  function pathFor(location: LocationOption): string {
    const parts = [location.name]
    let current = location
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      parts.unshift(parent.name)
      current = parent
    }
    return parts.join(" > ")
  }

  return locations
    .map((l) => ({ id: l.id, label: pathFor(l) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}