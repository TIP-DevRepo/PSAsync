"use client"

import { useState, useEffect } from "react"
import { Package } from "lucide-react"

interface AssetSummary {
  id: string
  assetTag: string
  catalogItemName: string
}

interface LocationGroup {
  id: string
  name: string
  deployed: AssetSummary[]
  unknown: AssetSummary[]
  containers: { id: string; path: string; assets: AssetSummary[] }[]
}

interface AssetDetail {
  id: string
  assetTag: string
  serialNumber: string | null
  status: string
  ownerClientId: string | null
  loanedToClientId: string | null
  locationId: string | null
  catalogItem: { name: string; categoryRef: { name: string; parent: { name: string } | null } }
  ownerClient: { name: string } | null
  clientLocation: { name: string } | null
  containerPath: string | null
  warrantyType: string | null
  warrantyExpiration: string | null
  notes: string | null
  customFieldValues: { value: string | null; customField: { name: string } }[]
}

function plainStatusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

// Sold and Loaned each get a compound label showing where the asset
// stands: InStock covers both a specific Container and Unknown (received
// but not yet sorted), since neither means it's actually out with
// someone. Deployed only applies once a real checkout action exists
// (Phase 10) — nothing produces that state yet. Decom applies once
// Removed. Everything else (In Stock at the company, Internal, In
// Repair) just shows its plain status.
function computeStatusLabel(asset: AssetDetail): string {
  if (asset.status === "REMOVED") {
    const prefix = asset.ownerClientId ? "Sold" : asset.loanedToClientId ? "Loaned" : "Removed"
    return prefix === "Removed" ? "Removed" : `${prefix} (Decom)`
  }
  if (asset.status === "SOLD") {
    return "Sold (InStock)"
  }
  if (asset.status === "LOANED") {
    return "Loaned (InStock)"
  }
  return plainStatusLabel(asset.status)
}

export function ClientAssetsPanel({ clientId }: { clientId: string }) {
  const [groups, setGroups] = useState<LocationGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AssetDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/assets`)
      .then((res) => res.json())
      .then((data) => {
        setGroups(data)
        setLoading(false)
      })
  }, [clientId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setLoadingDetail(true)
    fetch(`/api/inventory-assets/${selectedId}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data)
        setLoadingDetail(false)
      })
  }, [selectedId])

  const totalAssets = groups.reduce(
    (sum, g) => sum + g.deployed.length + g.unknown.length + g.containers.reduce((s, c) => s + c.assets.length, 0),
    0
  )

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (totalAssets === 0) {
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

  function AssetButton({ asset }: { asset: AssetSummary }) {
    const selected = selectedId === asset.id
    return (
      <button
        onClick={() => setSelectedId(asset.id)}
        className={`block w-full text-left rounded-md px-2 py-1 text-sm transition-colors ${
          selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface-hover"
        }`}
      >
        <span className="font-medium">{asset.assetTag}</span>
        <span className={selected ? "opacity-80" : "text-muted-foreground"}> — {asset.catalogItemName}</span>
      </button>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: location / container tree */}
      <div className="space-y-4">
        {groups
          .filter((g) => g.deployed.length > 0 || g.unknown.length > 0 || g.containers.length > 0)
          .map((group) => (
            <div key={group.id} className="rounded-lg border border-border bg-card shadow-card p-3 space-y-3">
              <p className="font-semibold text-sm text-foreground">{group.name}</p>

              {group.deployed.length > 0 && (
                <div className="pl-3 border-l-2 border-border space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Deployed</p>
                  <div className="space-y-0.5">
                    {group.deployed.map((a) => (
                      <AssetButton key={a.id} asset={a} />
                    ))}
                  </div>
                </div>
              )}

              {group.unknown.length > 0 && (
                <div className="pl-3 border-l-2 border-border space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Unknown</p>
                  <div className="space-y-0.5">
                    {group.unknown.map((a) => (
                      <AssetButton key={a.id} asset={a} />
                    ))}
                  </div>
                </div>
              )}

              {group.containers.map((container) => (
                <div key={container.id} className="pl-3 border-l-2 border-border space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{container.path}</p>
                  <div className="space-y-0.5">
                    {container.assets.map((a) => (
                      <AssetButton key={a.id} asset={a} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {/* Right: selected asset detail */}
      <div className="rounded-lg border border-border bg-card shadow-card p-4">
        {!selectedId ? (
          <p className="text-sm text-muted-foreground">Select an asset on the left to view its details.</p>
        ) : loadingDetail || !detail ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <h3 className="text-heading font-semibold text-foreground">{detail.assetTag}</h3>
              <p className="text-muted-foreground">{detail.catalogItem.name}</p>
            </div>
            <div className="space-y-1.5 pt-2 border-t border-border">
              <p><span className="font-medium text-foreground">Status:</span> <span className="text-muted-foreground">{computeStatusLabel(detail)}</span></p>
              <p><span className="font-medium text-foreground">Serial #:</span> <span className="text-muted-foreground">{detail.serialNumber ?? "—"}</span></p>
              <p>
                <span className="font-medium text-foreground">Category:</span>{" "}
                <span className="text-muted-foreground">
                  {detail.catalogItem.categoryRef.parent
                    ? `${detail.catalogItem.categoryRef.parent.name} > ${detail.catalogItem.categoryRef.name}`
                    : detail.catalogItem.categoryRef.name}
                </span>
              </p>
              <p><span className="font-medium text-foreground">Owner:</span> <span className="text-muted-foreground">{detail.ownerClient?.name ?? "—"}</span></p>
              <p><span className="font-medium text-foreground">Site:</span> <span className="text-muted-foreground">{detail.clientLocation?.name ?? "—"}</span></p>
              <p><span className="font-medium text-foreground">Container:</span> <span className="text-muted-foreground">{detail.containerPath ?? "Unknown (no container)"}</span></p>
              <p><span className="font-medium text-foreground">Warranty:</span> <span className="text-muted-foreground">{detail.warrantyType ?? "—"}</span></p>
              {detail.warrantyExpiration && (
                <p><span className="font-medium text-foreground">Warranty Expires:</span> <span className="text-muted-foreground">{new Date(detail.warrantyExpiration).toLocaleDateString()}</span></p>
              )}
            </div>
            {detail.customFieldValues.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-border">
                {detail.customFieldValues.map((v, i) => (
                  <p key={i}><span className="font-medium text-foreground">{v.customField.name}:</span> <span className="text-muted-foreground">{v.value ?? "—"}</span></p>
                ))}
              </div>
            )}
            {detail.notes && (
              <div className="pt-2 border-t border-border">
                <p className="font-medium text-foreground mb-1">Notes</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{detail.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}