// Shared by the purchase order page (POLineItemBuilder) and the line item
// PATCH route, so the UI and the server always agree on which lines go
// through receiving. Safe to import on the client.

// A line item only goes through Inventory receiving (the receive route,
// which creates the assets or stock) if it's linked to a Catalog Item AND
// that item's type is Physical. Services, Subscriptions, Bundles, and ad
// hoc rows have nothing to track, so they're simply marked received.
export function isInventoryTrackedLine(line: {
  catalogItemId: string | null
  catalogItem: { type: string } | null
}): boolean {
  return line.catalogItemId !== null && line.catalogItem?.type === "PHYSICAL"
}

export const USE_RECEIVE_MESSAGE = "Use Receive to add this item to inventory"
