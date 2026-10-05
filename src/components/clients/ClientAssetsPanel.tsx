"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Package, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { computeStatusLabel, currentUserLabel, statusBadgeClass } from "@/lib/inventory/statusLabel"
import { AddInventoryItemModal } from "@/components/inventory/AddInventoryItemModal"
import { confirmDialog } from "@/lib/confirm-dialog"
import { toast } from "@/lib/toast"

interface AssetRow {
  id: string
  assetTag: string
  serialNumber: string | null
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [search, setSearch] = useState("")
  const [canDelete, setCanDelete] = useState(false)

  function loadAssets() {
    fetch(`/api/clients/${clientId}/assets`)
      .then((res) => res.json())
      .then((data) => {
        setAssets(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadAssets()
  }, [clientId])

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((session) => {
        const role = session?.user?.role
        setCanDelete(!!role?.isGlobalAdmin || !!role?.permissions?.inventory?.delete)
      })
  }, [])

  async function handleDeleteAsset(asset: AssetRow) {
    const confirmed = await confirmDialog({
      title: `Delete asset ${asset.assetTag}?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/inventory-assets/${asset.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Asset deleted")
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error("Couldn't delete this asset", data.error)
    }
  }

  const addModal = showAddModal && (
    <AddInventoryItemModal
      initialClientId={clientId}
      onClose={() => setShowAddModal(false)}
      onDone={loadAssets}
    />
  )

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (assets.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button onClick={() => setShowAddModal(true)}>Add Inventory Item</Button>
        </div>
        {addModal}
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium text-foreground">No assets yet</p>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            Hardware sold or shipped to this client will show up here once it&apos;s received.
          </p>
        </div>
      </div>
    )
  }

  const activeOnly = showInactive ? assets : assets.filter((a) => a.status !== "REMOVED")
  const q = search.trim().toLowerCase()
  const visible = q
    ? activeOnly.filter(
        (a) =>
          a.catalogItem.name.toLowerCase().includes(q) ||
          a.assetTag.toLowerCase().includes(q) ||
          (a.serialNumber ?? "").toLowerCase().includes(q)
      )
    : activeOnly

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <input
          type="text"
          placeholder="Search by name, serial, or asset tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          value={showInactive ? "all" : "active"}
          onChange={(e) => { setShowInactive(e.target.value === "all"); e.target.blur() }}
          className={SELECT_CLASS}
        >
          <option value="active">Active Only</option>
          <option value="all">Active & Inactive</option>
        </select>
        <Button onClick={() => setShowAddModal(true)}>Add Inventory Item</Button>
      </div>

      {addModal}

      <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th className="py-2 pl-4 pr-3">Asset Tag</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Location/Container</th>
              <th className="py-2 pr-3">Current User</th>
              <th className="py-2 pr-4">Catalog Item</th>
              {canDelete && <th className="py-2 pr-4" />}
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
                {canDelete && (
                  <td className="py-2 pr-4 text-right">
                    <button
                      onClick={() => handleDeleteAsset(asset)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger"
                      title="Delete asset"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 6 : 5} className="py-6 text-center text-muted-foreground">
                  {q
                    ? "No assets match your search."
                    : "No active assets. Switch to \"Active & Inactive\" to see decommissioned ones."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
