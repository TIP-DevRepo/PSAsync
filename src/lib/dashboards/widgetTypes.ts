export type WidgetType = "INVENTORY_BY_STATUS" | "INVENTORY_BY_CLIENT" | "OPEN_QUOTES" | "OPEN_POS" | "TOTAL_CLIENTS"
export type WidgetSize = "SMALL" | "MEDIUM" | "LARGE"

// The dashboard grid is a fixed 4 columns by 4 rows (16 squares). Small
// is a single square, Medium a 2-square domino, Large a 2x2 block —
// matching the col/row spans BentoTile already applies per size.
export const GRID_COLUMNS = 4
export const GRID_ROWS = 4
export const GRID_TOTAL_CELLS = GRID_COLUMNS * GRID_ROWS

export const WIDGET_SIZE_CELLS: Record<WidgetSize, number> = {
  SMALL: 1,
  MEDIUM: 2,
  LARGE: 4,
}

interface PagePermissions {
  inventory?: boolean
  quotes?: boolean
  purchaseOrders?: boolean
  clients?: boolean
}

// Which existing page-access flag gates each widget type. A user who
// can't see the Inventory section, for instance, shouldn't be offered
// (or able to add) an Inventory widget on their dashboard either.
const WIDGET_PAGE_PERMISSION: Record<WidgetType, keyof PagePermissions> = {
  INVENTORY_BY_STATUS: "inventory",
  INVENTORY_BY_CLIENT: "inventory",
  OPEN_QUOTES: "quotes",
  OPEN_POS: "purchaseOrders",
  TOTAL_CLIENTS: "clients",
}

export const WIDGET_LABELS: Record<WidgetType, string> = {
  INVENTORY_BY_STATUS: "Assets by Status",
  INVENTORY_BY_CLIENT: "Assets by Client",
  OPEN_QUOTES: "Open Quotes",
  OPEN_POS: "Open Purchase Orders",
  TOTAL_CLIENTS: "Total Clients",
}

export function canViewWidgetType(pagePermissions: PagePermissions, widgetType: WidgetType): boolean {
  const key = WIDGET_PAGE_PERMISSION[widgetType]
  return !!pagePermissions[key]
}

export function allowedWidgetTypes(pagePermissions: PagePermissions): WidgetType[] {
  return (Object.keys(WIDGET_LABELS) as WidgetType[]).filter((t) => canViewWidgetType(pagePermissions, t))
}
