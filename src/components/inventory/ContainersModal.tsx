"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Plus, Pencil, Trash2, Check, X, Star } from "lucide-react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Container {
  id: string
  name: string
  parentId: string | null
}

interface ContainerTreeItem extends Container {
  children: ContainerTreeItem[]
}

function buildTree(flat: Container[]): ContainerTreeItem[] {
  const nodes = new Map<string, ContainerTreeItem>()
  flat.forEach((c) => nodes.set(c.id, { ...c, children: [] }))

  const roots: ContainerTreeItem[] = []
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortByName = (a: ContainerTreeItem, b: ContainerTreeItem) => a.name.localeCompare(b.name)
  const sortRecursive = (list: ContainerTreeItem[]) => {
    list.sort(sortByName)
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}

export function ContainersModal({
  clientLocationId,
  locationName,
  onClose,
}: {
  clientLocationId: string
  locationName: string
  onClose: () => void
}) {
  const [containers, setContainers] = useState<Container[]>([])
  const [defaultContainerId, setDefaultContainerId] = useState<string | null>(null)
  const [savingDefault, setSavingDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newTopLevelName, setNewTopLevelName] = useState("")
  const [creatingTopLevel, setCreatingTopLevel] = useState(false)

  function loadContainers() {
    fetch(`/api/inventory-locations?clientLocationId=${clientLocationId}`)
      .then((res) => res.json())
      .then((data) => {
        setContainers(data.locations)
        setDefaultContainerId(data.defaultContainerId)
        setLoading(false)
      })
  }

  async function handleSetDefault(containerId: string) {
    // Clicking the already-starred container clears the default, clicking
    // a different one moves the star, only one default per site.
    const nextValue = defaultContainerId === containerId ? null : containerId
    setSavingDefault(true)
    const res = await fetch(`/api/client-locations/${clientLocationId}/default-container`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ containerId: nextValue }),
    })
    setSavingDefault(false)
    if (res.ok) {
      setDefaultContainerId(nextValue)
      toast.success(nextValue ? "Default container set" : "Default container cleared")
    } else {
      toast.error("Couldn't update default container")
    }
  }

  useEffect(() => {
    loadContainers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientLocationId])

  async function handleCreate(name: string, parentId: string | null) {
    const res = await fetch("/api/inventory-locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId, clientLocationId }),
    })
    if (res.ok) {
      toast.success(parentId ? "Sub-container added" : "Container added")
      loadContainers()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't add container")
      return false
    }
  }

  async function handleRename(id: string, name: string) {
    const res = await fetch(`/api/inventory-locations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      toast.success("Container renamed")
      loadContainers()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't rename container")
      return false
    }
  }

  async function handleDelete(container: Container) {
    const confirmed = await confirmDialog({
      title: `Delete "${container.name}"?`,
      description: "This can't be undone. Containers with sub-containers still attached can't be deleted, move or remove those first.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/inventory-locations/${container.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Container deleted")
      loadContainers()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't delete container")
    }
  }

  async function handleCreateTopLevel() {
    if (!newTopLevelName.trim()) return
    setCreatingTopLevel(true)
    const ok = await handleCreate(newTopLevelName.trim(), null)
    setCreatingTopLevel(false)
    if (ok) setNewTopLevelName("")
  }

  const tree = buildTree(containers)

  return (
    <Modal maxWidth="lg" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Containers: {locationName}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Build out shelves, racks, and slots at this site, so stocked hardware can be tracked precisely.
      </p>

      {containers.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Click the star on a container to set it as the default, pre-selected when receiving hardware here. Only one container per site can be the default, clicking a starred container again clears it.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={newTopLevelName}
          onChange={(e) => setNewTopLevelName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTopLevel()}
          placeholder="e.g. Server Room, Main Shelf"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handleCreateTopLevel} disabled={creatingTopLevel || !newTopLevelName.trim()}>
          {creatingTopLevel ? "Adding..." : "Add Container"}
        </Button>
      </div>

      <div className="mt-4 space-y-1 max-h-96 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {tree.map((node) => (
              <ContainerTreeNode
                key={node.id}
                node={node}
                depth={0}
                defaultContainerId={defaultContainerId}
                savingDefault={savingDefault}
                onCreateChild={handleCreate}
                onRename={handleRename}
                onDelete={handleDelete}
                onToggleDefault={handleSetDefault}
              />
            ))}
            {tree.length === 0 && (
              <p className="text-sm text-muted-foreground">No containers yet. Add one above.</p>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

function ContainerTreeNode({
  node,
  depth,
  defaultContainerId,
  savingDefault,
  onCreateChild,
  onRename,
  onDelete,
  onToggleDefault,
}: {
  node: ContainerTreeItem
  depth: number
  defaultContainerId: string | null
  savingDefault: boolean
  onCreateChild: (name: string, parentId: string | null) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (container: Container) => void
  onToggleDefault: (containerId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [addingChild, setAddingChild] = useState(false)
  const [childName, setChildName] = useState("")
  const [savingChild, setSavingChild] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const [savingRename, setSavingRename] = useState(false)

  async function submitChild() {
    if (!childName.trim()) return
    setSavingChild(true)
    const ok = await onCreateChild(childName.trim(), node.id)
    setSavingChild(false)
    if (ok) {
      setChildName("")
      setAddingChild(false)
      setExpanded(true)
    }
  }

  async function submitRename() {
    if (!renameValue.trim()) return
    setSavingRename(true)
    const ok = await onRename(node.id, renameValue.trim())
    setSavingRename(false)
    if (ok) setRenaming(false)
  }

  return (
    <div>
      <div
        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
        style={{ marginLeft: depth * 20 }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {node.children.length > 0 ? (
            <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground">
              <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="w-[14px]" />
          )}

          {!renaming ? (
            <span className="text-foreground truncate">{node.name}</span>
          ) : (
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!renaming ? (
            <>
              <button
                onClick={() => onToggleDefault(node.id)}
                disabled={savingDefault}
                title={defaultContainerId === node.id ? "Remove as default container" : "Set as default container"}
                className={defaultContainerId === node.id ? "text-warning" : "text-muted-foreground hover:text-foreground"}
              >
                <Star size={14} fill={defaultContainerId === node.id ? "currentColor" : "none"} />
              </button>
              <button
                onClick={() => setAddingChild((v) => !v)}
                title="Add sub-container"
                className="text-muted-foreground hover:text-foreground"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => {
                  setRenameValue(node.name)
                  setRenaming(true)
                }}
                title="Rename"
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDelete(node)}
                title="Delete"
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <>
              <button onClick={submitRename} disabled={savingRename} title="Save" className="text-success hover:opacity-80">
                <Check size={14} />
              </button>
              <button onClick={() => setRenaming(false)} title="Cancel" className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {addingChild && (
        <div className="flex gap-2 mt-1" style={{ marginLeft: (depth + 1) * 20 }}>
          <input
            autoFocus
            type="text"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitChild()}
            placeholder="Sub-container name"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" onClick={submitChild} disabled={savingChild || !childName.trim()}>
            {savingChild ? "Adding..." : "Add"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setAddingChild(false); setChildName("") }}>
            Cancel
          </Button>
        </div>
      )}

      {expanded && node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <ContainerTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              defaultContainerId={defaultContainerId}
              savingDefault={savingDefault}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onToggleDefault={onToggleDefault}
            />
          ))}
        </div>
      )}
    </div>
  )
}