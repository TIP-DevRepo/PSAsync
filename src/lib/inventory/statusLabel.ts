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
