"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Package } from "lucide-react"
import { computeStatusLabel, currentUserLabel, statusBadgeClass } from "@/lib/inventory/statusLabel"

interface AssetRow {
  id: string
  assetTag: string
  status: string
  ownerClientId: string | null
  loanedToClientId: string | null
  deployedToContactId: string | null
  clientLocation: { name: string } | null
  containerPath: string | null
  catalogItem: { name: string }
  deployedToContact: { firstName: string; lastName: string } | null
  loanedToContact: { firstName: string; lastName: string } | null
  assignedUser: { name: string } | null
}

function locationLabel(a: AssetRow): string {
  return a.containerPath ?? a.clientLocation?.name ?? "Unassigned"
}

const SELECT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function ClientAssetsPanel({ clientId }: { clientId: string }) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/assets`)
      .then((res) => res.json())
      .then((data) => {
        setAssets(data)
        setLoading(false)
      })
  }, [clientId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
        <Package className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium text-foreground">No assets yet</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
          Hardware sold or shipped to this client will show up here once it's received.
        </p>
      </div>
    )
  }

  const visible = showInactive ? assets : assets.filter((a) => a.status !== "REMOVED")

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <select
          value={showInactive ? "all" : "active"}
          onChange={(e) => { setShowInactive(e.target.value === "all"); e.target.blur() }}
          className={SELECT_CLASS}
        >
          <option value="active">Active Only</option>
          <option value="all">Active & Inactive</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th className="py-2 pl-4 pr-3">Asset Tag</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Location/Container</th>
              <th className="py-2 pr-3">Current User</th>
              <th className="py-2 pr-4">Catalog Item</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((asset) => (
              <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-surface-hover transition-colors">
                <td className="py-2 pl-4 pr-3">
                  <Link href={`/dashboard/inventory/${asset.id}`} className="font-medium text-primary hover:underline">
                    {asset.assetTag}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClass(asset)}`}>
                    {computeStatusLabel(asset)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-foreground">{locationLabel(asset)}</td>
                <td className="py-2 pr-3 text-foreground">{currentUserLabel(asset)}</td>
                <td className="py-2 pr-4 text-muted-foreground">{asset.catalogItem.name}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No active assets. Switch to "Active & Inactive" to see decommissioned ones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
