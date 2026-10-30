// HaloPSA style column filters for a list table: a text box under each
// column name filters that column with a case insensitive "contains" match
// against the text the column shows, and several boxes combine with AND.
// Kept in the URL as f_<column key>=<text>, so a refresh or a shared link
// keeps them. Shared by the opportunities list and, later, the tickets
// list (ColumnFilterRow in src/components/table/ColumnFilters.tsx). No
// React and no database imports.
//
// Filtering runs on the rows already loaded, since those lists aren't
// paged; a paged list (the audit log) sends the URL's filters to the
// server instead and keeps the same f_<column key> parameters.

export const COLUMN_FILTER_PREFIX = "f_"
// Characters a column filter keeps from the URL
export const COLUMN_FILTER_MAX = 100

export type ColumnFilters = Record<string, string>

export const columnFilterParam = (key: string) => `${COLUMN_FILTER_PREFIX}${key}`

// A column a list can filter: its key (the URL's f_<key>) and the text it
// shows for a row, which is what a filter matches
export interface FilterableColumn<T> {
  key: string
  text: (row: T) => string
}

// The column filters in the URL, only for the given column keys; blank
// ones are left out
export function readColumnFilters(params: { get(name: string): string | null }, keys: readonly string[]): ColumnFilters {
  const filters: ColumnFilters = {}
  for (const key of keys) {
    const value = (params.get(columnFilterParam(key)) ?? "").slice(0, COLUMN_FILTER_MAX)
    if (value.trim()) filters[key] = value
  }
  return filters
}

// The query string (without "?") with the column filters written in and
// every other parameter kept. Blank filters are removed from it.
export function writeColumnFilters(search: string, filters: ColumnFilters, keys: readonly string[]): string {
  const params = new URLSearchParams(search)
  for (const key of keys) {
    const value = (filters[key] ?? "").trim()
    if (value) params.set(columnFilterParam(key), value.slice(0, COLUMN_FILTER_MAX))
    else params.delete(columnFilterParam(key))
  }
  return params.toString()
}

export function hasColumnFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some((v) => v.trim() !== "")
}

// True when the row's shown text contains every filter's text, ignoring case
export function matchesColumnFilters<T>(row: T, filters: ColumnFilters, columns: readonly FilterableColumn<T>[]): boolean {
  return columns.every((column) => {
    const wanted = (filters[column.key] ?? "").trim().toLowerCase()
    return !wanted || column.text(row).toLowerCase().includes(wanted)
  })
}

export function filterRowsByColumns<T>(rows: readonly T[], filters: ColumnFilters, columns: readonly FilterableColumn<T>[]): T[] {
  return hasColumnFilters(filters) ? rows.filter((row) => matchesColumnFilters(row, filters, columns)) : [...rows]
}
