"use client"

import { useState, useEffect } from "react"
import { Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CheckoutModal } from "@/components/inventory/CheckoutModal"
import { ReturnModal } from "@/components/inventory/ReturnModal"
import { OffboardModal } from "@/components/inventory/OffboardModal"
import { RemoveAssetModal } from "@/components/inventory/RemoveAssetModal"

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
  deployedToContactId: string | null
  loanedToContactId: string | null
  locationId: string | null
  catalogItem: { name: string; categoryRef: { name: string; parent: { name: string } | null } }
  ownerClient: { name: string } | null
  clientLocation: { name: string } | null
  containerPath: string | null
  warrantyType: string | null
  warrantyExpiration: string | null
  notes: string | null
  customFieldValues: { value: string | null; customField: { name: string } }[]
  deployedToContact: { firstName: string; lastName: string } | null
  loanedToContact: { firstName: string; lastName: string } | null
  assignedUser: { name: string } | null
}

function currentUserLabel(asset: AssetDetail): string {
  if (asset.deployedToContact) return `${asset.deployedToContact.firstName} ${asset.deployedToContact.lastName}`
  if (asset.loanedToContact) return `${asset.loanedToContact.firstName} ${asset.loanedToContact.lastName}`
  if (asset.assignedUser) return asset.assignedUser.name
  return "None"
}

function plainStatusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

// Sold and Loaned each get a compound label showing where the asset
// stands: Deployed once it's assigned to a specific Contact, InStock
// otherwise (covers both a Container and Unknown, neither means it's
// actually out with someone). Decom applies once Removed.
function computeStatusLabel(asset: AssetDetail): string {
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

type ModalKind = "checkout" | "return" | "offboard" | "remove" | null

export function ClientAssetsPanel({ clientId }: { clientId: string }) {
  const [groups, setGroups] = useState<LocationGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AssetDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [openModal, setOpenModal] = useState<ModalKind>(null)

  function loadGroups() {
    fetch(`/api/clients/${clientId}/assets`)
      .then((res) => res.json())
      .then((data) => {
        setGroups(data)
        setLoading(false)
      })
  }

  function loadDetail() {
    if (!selectedId) return
    setLoadingDetail(true)
    fetch(`/api/inventory-assets/${selectedId}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data)
        setLoadingDetail(false)
      })
  }

  useEffect(() => {
    loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Any checkout/return/offboard/remove action can move an asset between
  // groups (Unknown, a Container, or eventually Deployed) — refresh both
  // the left tree and whichever asset is currently selected.
  function handleActionDone() {
    loadGroups()
    loadDetail()
  }

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

            <div className="flex flex-wrap gap-2 pb-1">
              {(detail.status === "IN_STOCK" ||
                (detail.status === "SOLD" && detail.ownerClientId && !detail.deployedToContactId)) && (
                <Button size="sm" onClick={() => setOpenModal("checkout")}>Check Out</Button>
              )}
              {["SOLD", "LOANED", "INTERNAL"].includes(detail.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="bg-brand-secondary-500/10 text-brand-secondary-500 hover:bg-brand-secondary-500/20"
                  onClick={() => setOpenModal("return")}
                >
                  Return to Stock
                </Button>
              )}
              {detail.status === "PENDING_OFFBOARD" && (
                <Button size="sm" onClick={() => setOpenModal("offboard")}>Finish Offboarding</Button>
              )}
              {detail.status !== "REMOVED" && (
                <Button size="sm" variant="destructive" onClick={() => setOpenModal("remove")}>Remove</Button>
              )}
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
              <p><span className="font-medium text-foreground">Current User:</span> <span className="text-muted-foreground">{currentUserLabel(detail)}</span></p>
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

      {openModal === "checkout" && detail && (
        <CheckoutModal
          assetId={detail.id}
          deployFromClientId={detail.status === "SOLD" && detail.ownerClientId ? detail.ownerClientId : undefined}
          onClose={() => setOpenModal(null)}
          onDone={handleActionDone}
        />
      )}
      {openModal === "return" && detail && (
        <ReturnModal assetId={detail.id} assetStatus={detail.status} onClose={() => setOpenModal(null)} onDone={handleActionDone} />
      )}
      {openModal === "offboard" && detail && (
        <OffboardModal assetId={detail.id} onClose={() => setOpenModal(null)} onDone={handleActionDone} />
      )}
      {openModal === "remove" && detail && (
        <RemoveAssetModal assetId={detail.id} onClose={() => setOpenModal(null)} onDone={handleActionDone} />
      )}
    </div>
  )
}