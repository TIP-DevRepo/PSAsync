export function plainStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

// Sold and Loaned each get a compound label showing where the asset
// stands: Deployed once it's assigned to a specific Contact, InStock
// otherwise (covers both a Container and Unknown, neither means it's
// actually out with someone). Decom applies once Removed.
export function computeStatusLabel(asset: {
  status: string
  ownerClientId: string | null
  loanedToClientId: string | null
  deployedToContactId: string | null
}): string {
  if (asset.status === "REMOVED") {
    const prefix = asset.ownerClientId ? "Sold" : asset.loanedToClientId ? "Loaned" : "Removed"
    return prefix === "Removed" ? "Removed" : `${prefix} (Decom)`
  }
  if (asset.status === "SOLD") {
    return asset.deployedToContactId ? "Sold (Deployed)" : "Sold (InStock)"
  }
  if (asset.status === "LOANED") {
    return "Loaned (Deployed)"
  }
  if (asset.status === "INTERNAL") {
    return "Internal (Deployed)"
  }
  return plainStatusLabel(asset.status)
}

// Color for the status badge, mirroring computeStatusLabel's own
// branching so the two never drift apart: green for anything sitting
// in stock, blue for anything deployed/out with someone, amber for a
// state that needs attention, gray for decommissioned.
export function statusBadgeClass(asset: {
  status: string
  ownerClientId: string | null
  loanedToClientId: string | null
  deployedToContactId: string | null
}): string {
  if (asset.status === "REMOVED") {
    return "bg-muted text-muted-foreground"
  }
  if (asset.status === "SOLD") {
    return asset.deployedToContactId ? "bg-info-bg text-info" : "bg-success-bg text-success"
  }
  if (asset.status === "LOANED" || asset.status === "INTERNAL") {
    return "bg-info-bg text-info"
  }
  if (asset.status === "PENDING_OFFBOARD") {
    return "bg-warning-bg text-warning"
  }
  if (asset.status === "IN_STOCK") {
    return "bg-success-bg text-success"
  }
  return "bg-muted text-muted-foreground"
}

export function currentUserLabel(asset: {
  deployedToContact: { firstName: string; lastName: string } | null
  loanedToContact: { firstName: string; lastName: string } | null
  assignedUser: { name: string } | null
}): string {
  if (asset.deployedToContact) return `${asset.deployedToContact.firstName} ${asset.deployedToContact.lastName}`
  if (asset.loanedToContact) return `${asset.loanedToContact.firstName} ${asset.loanedToContact.lastName}`
  if (asset.assignedUser) return asset.assignedUser.name
  return "None"
}
