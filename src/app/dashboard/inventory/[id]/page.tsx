"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TabsBar } from "@/components/ui/tabs-bar"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"
import { CheckoutModal } from "@/components/inventory/CheckoutModal"
import { ReturnModal } from "@/components/inventory/ReturnModal"
import { OffboardModal } from "@/components/inventory/OffboardModal"
import { RemoveAssetModal } from "@/components/inventory/RemoveAssetModal"
import { RedeployModal } from "@/components/inventory/RedeployModal"
import { plainStatusLabel, computeStatusLabel, statusBadgeClass } from "@/lib/inventory/statusLabel"

interface AssetEvent {
  id: string
  eventType: string
  description: string
  createdAt: string
  performedByUser: { name: string } | null
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
  loanExpectedReturnDate: string | null
  locationId: string | null
  removedReason: string | null
  warrantyType: string | null
  warrantyExpiration: string | null
  overrideVendorSku: string | null
  overrideManufacturerSku: string | null
  notes: string | null
  catalogItem: { name: string; categoryRef: { name: string; parent: { name: string } | null } }
  ownerClient: { id: string; name: string; inventoryOnboarded: boolean } | null
  loanedToClient: { id: string; name: string; inventoryOnboarded: boolean } | null
  clientLocation: { name: string } | null
  containerPath: string | null
  customFieldValues: { value: string | null; customField: { name: string } }[]
  deployedToContact: { firstName: string; lastName: string } | null
  loanedToContact: { firstName: string; lastName: string } | null
  assignedUser: { name: string } | null
  overrideVendor: { name: string } | null
  overrideManufacturer: { name: string } | null
  inventoryAssetEvents: AssetEvent[]
}

interface AttachmentType {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  createdAt: string
}

type AssetTabKey = "details" | "attachments" | "auditTrail" | "repairHistory"

const ASSET_TABS: { key: AssetTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "attachments", label: "Attachments" },
  { key: "auditTrail", label: "Audit Trail" },
  { key: "repairHistory", label: "Repair History" },
]

function currentUserLabel(asset: AssetDetail): string {
  if (asset.deployedToContact) return `${asset.deployedToContact.firstName} ${asset.deployedToContact.lastName}`
  if (asset.loanedToContact) return `${asset.loanedToContact.firstName} ${asset.loanedToContact.lastName}`
  if (asset.assignedUser) return asset.assignedUser.name
  return "None"
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type ModalKind = "checkout" | "return" | "offboard" | "remove" | "redeploy" | null

function isDeployed(asset: AssetDetail): boolean {
  if (asset.status === "INTERNAL") return true
  if (asset.status === "LOANED") return true
  return asset.status === "SOLD" && !!asset.deployedToContactId
}

// The client relevant to a Return action — the owner (Sold) or the
// borrower (Loaned). Internal never touches a client.
function returnClientFor(asset: AssetDetail) {
  if (asset.status === "SOLD") return asset.ownerClient
  if (asset.status === "LOANED") return asset.loanedToClient
  return null
}

export default function InventoryAssetDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<AssetTabKey>("details")
  const [attachments, setAttachments] = useState<AttachmentType[]>([])
  const [openModal, setOpenModal] = useState<ModalKind>(null)

  function loadAsset() {
    fetch(`/api/inventory-assets/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setAsset(data)
        setLoading(false)
      })
  }

  function loadAttachments() {
    fetch(`/api/inventory-assets/${id}/attachments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setAttachments(data))
  }

  useEffect(() => {
    loadAsset()
    loadAttachments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/inventory-assets/${id}/attachments/${attachmentId}`, { method: "DELETE" })
    loadAttachments()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (!asset) return <p className="text-sm text-danger">Asset not found.</p>

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/inventory" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Inventory
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-display font-semibold tracking-tight text-foreground">{asset.assetTag}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(asset)}`}>
            {computeStatusLabel(asset)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{asset.catalogItem.name}</p>
      </div>

      <TabsBar tabs={ASSET_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Asset sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex flex-wrap gap-2">
              {(asset.status === "IN_STOCK" ||
                (asset.status === "SOLD" && asset.ownerClientId && !asset.deployedToContactId)) && (
                <Button size="sm" onClick={() => setOpenModal("checkout")}>Check Out</Button>
              )}
              {isDeployed(asset) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="bg-info-bg text-info hover:bg-info/20"
                  onClick={() => setOpenModal("redeploy")}
                >
                  Re-deploy
                </Button>
              )}
              {["SOLD", "LOANED", "INTERNAL"].includes(asset.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="bg-brand-secondary-500/10 text-brand-secondary-500 hover:bg-brand-secondary-500/20"
                  onClick={() => setOpenModal("return")}
                >
                  Return to Stock
                </Button>
              )}
              {asset.status === "PENDING_OFFBOARD" && (
                <Button size="sm" onClick={() => setOpenModal("offboard")}>Finish Offboarding</Button>
              )}
              {asset.status !== "REMOVED" && (
                <Button size="sm" variant="destructive" onClick={() => setOpenModal("remove")}>Remove</Button>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1.5 text-sm">
              <p><span className="font-medium text-foreground">Status:</span> <span className="text-muted-foreground">{computeStatusLabel(asset)}</span></p>
              <p><span className="font-medium text-foreground">Serial #:</span> <span className="text-muted-foreground">{asset.serialNumber ?? "—"}</span></p>
              <p>
                <span className="font-medium text-foreground">Category:</span>{" "}
                <span className="text-muted-foreground">
                  {asset.catalogItem.categoryRef.parent
                    ? `${asset.catalogItem.categoryRef.parent.name} > ${asset.catalogItem.categoryRef.name}`
                    : asset.catalogItem.categoryRef.name}
                </span>
              </p>
              <p><span className="font-medium text-foreground">Owner:</span> <span className="text-muted-foreground">{asset.ownerClient?.name ?? "—"}</span></p>
              <p><span className="font-medium text-foreground">Current User:</span> <span className="text-muted-foreground">{currentUserLabel(asset)}</span></p>
              <p><span className="font-medium text-foreground">Site:</span> <span className="text-muted-foreground">{asset.clientLocation?.name ?? "—"}</span></p>
              <p><span className="font-medium text-foreground">Container:</span> <span className="text-muted-foreground">{asset.containerPath ?? "Unknown (no container)"}</span></p>
              <p><span className="font-medium text-foreground">Warranty:</span> <span className="text-muted-foreground">{asset.warrantyType ?? "—"}</span></p>
              {asset.warrantyExpiration && (
                <p><span className="font-medium text-foreground">Warranty Expires:</span> <span className="text-muted-foreground">{new Date(asset.warrantyExpiration).toLocaleDateString()}</span></p>
              )}
              {asset.loanedToClient && (
                <p><span className="font-medium text-foreground">Loaned To:</span> <span className="text-muted-foreground">{asset.loanedToClient.name}{asset.loanExpectedReturnDate ? ` (expected back ${new Date(asset.loanExpectedReturnDate).toLocaleDateString()})` : ""}</span></p>
              )}
              {asset.status === "REMOVED" && asset.removedReason && (
                <p><span className="font-medium text-foreground">Removed Reason:</span> <span className="text-muted-foreground">{plainStatusLabel(asset.removedReason)}</span></p>
              )}
              {asset.overrideVendor && (
                <p><span className="font-medium text-foreground">Vendor Override:</span> <span className="text-muted-foreground">{asset.overrideVendor.name}{asset.overrideVendorSku ? ` (${asset.overrideVendorSku})` : ""}</span></p>
              )}
              {asset.overrideManufacturer && (
                <p><span className="font-medium text-foreground">Manufacturer Override:</span> <span className="text-muted-foreground">{asset.overrideManufacturer.name}{asset.overrideManufacturerSku ? ` (${asset.overrideManufacturerSku})` : ""}</span></p>
              )}
            </div>

            {asset.customFieldValues.length > 0 && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1.5 text-sm">
                {asset.customFieldValues.map((v, i) => (
                  <p key={i}><span className="font-medium text-foreground">{v.customField.name}:</span> <span className="text-muted-foreground">{v.value ?? "—"}</span></p>
                ))}
              </div>
            )}

            {asset.notes && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 text-sm">
                <p className="font-medium text-foreground mb-1">Notes</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{asset.notes}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "attachments" && (
          <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold text-sm text-foreground">Attachments</h2>
            <FileUploadZone uploadUrl={`/api/inventory-assets/${id}/attachments`} onUploaded={loadAttachments} />
            <div className="space-y-2">
              {attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {a.fileName}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fileSizeLabel(a.fileSize)}</span>
                    <button onClick={() => handleDeleteAttachment(a.id)} className="text-xs text-danger hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "auditTrail" && (
          <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-caption text-muted-foreground">
                  <th className="py-2 pl-4 pr-3">Event</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">By</th>
                  <th className="py-2 pr-4">When</th>
                </tr>
              </thead>
              <tbody>
                {asset.inventoryAssetEvents.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="py-2 pl-4 pr-3 font-medium text-foreground">{plainStatusLabel(e.eventType)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{e.description}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{e.performedByUser?.name ?? "System"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {asset.inventoryAssetEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      No events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "repairHistory" && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
            <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">Repair history coming soon</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Tracking repairs sent out or done in-house will show up here once the Repair module (Phase 11) is built.
            </p>
          </div>
        )}
      </div>

      {openModal === "checkout" && (
        <CheckoutModal
          assetId={asset.id}
          deployFromClientId={asset.status === "SOLD" && asset.ownerClientId ? asset.ownerClientId : undefined}
          onClose={() => setOpenModal(null)}
          onDone={loadAsset}
        />
      )}
      {openModal === "return" && (
        <ReturnModal
          assetId={asset.id}
          assetStatus={asset.status}
          client={returnClientFor(asset)}
          onClose={() => setOpenModal(null)}
          onDone={loadAsset}
        />
      )}
      {openModal === "offboard" && (
        <OffboardModal assetId={asset.id} onClose={() => setOpenModal(null)} onDone={loadAsset} />
      )}
      {openModal === "remove" && (
        <RemoveAssetModal assetId={asset.id} onClose={() => setOpenModal(null)} onDone={loadAsset} />
      )}
      {openModal === "redeploy" && (
        <RedeployModal
          assetId={asset.id}
          status={asset.status}
          clientId={
            asset.status === "SOLD" ? asset.ownerClientId ?? undefined
              : asset.status === "LOANED" ? asset.loanedToClientId ?? undefined
              : undefined
          }
          currentLoanExpectedReturnDate={asset.loanExpectedReturnDate}
          onClose={() => setOpenModal(null)}
          onDone={loadAsset}
        />
      )}
    </div>
  )
}
