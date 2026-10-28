// The one rule for a client's "main location": its primary location (the
// first by name if more than one is marked primary), else its main billing
// location, else none. Used when an opportunity is created or its client
// changes (the default location), by the New opportunity dialog's Location
// select, and by the Client details display. No React and no database
// imports, so servers and pages share it.

export function mainClientLocation<T extends { name: string; isPrimary?: boolean | null }>(client: {
  locations?: readonly T[] | null
  mainBillingLocation?: T | null
}): T | null {
  const primary = (client.locations ?? []).filter((l) => l.isPrimary).sort((a, b) => a.name.localeCompare(b.name))[0]
  return primary ?? client.mainBillingLocation ?? null
}
