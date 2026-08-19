"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Plus, Pencil, Trash2, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Location {
  id: string
  name: string
  parentId: string | null
}

interface LocationTreeItem extends Location {
  children: LocationTreeItem[]
}

function buildTree(flat: Location[]): LocationTreeItem[] {
  const nodes = new Map<string, LocationTreeItem>()
  flat.forEach((l) => nodes.set(l.id, { ...l, children: [] }))

  const roots: LocationTreeItem[] = []
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortByName = (a: LocationTreeItem, b: LocationTreeItem) => a.name.localeCompare(b.name)
  const sortRecursive = (list: LocationTreeItem[]) => {
    list.sort(sortByName)
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}

export function InventoryLocationsSettingsPanel() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [newTopLevelName, setNewTopLevelName] = useState("")
  const [creatingTopLevel, setCreatingTopLevel] = useState(false)

  function loadLocations() {
    fetch("/api/inventory-locations")
      .then((res) => res.json())
      .then((data) => {
        setLocations(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadLocations()
  }, [])

  async function handleCreate(name: string, parentId: string | null) {
    const res = await fetch("/api/inventory-locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    })
    if (res.ok) {
      toast.success(parentId ? "Sub-location added" : "Location added")
      loadLocations()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't add location")
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
      toast.success("Location renamed")
      loadLocations()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't rename location")
      return false
    }
  }

  async function handleDelete(location: Location) {
    const confirmed = await confirmDialog({
      title: `Delete "${location.name}"?`,
      description: "This can't be undone. Locations with sub-locations still attached can't be deleted, move or remove those first.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/inventory-locations/${location.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Location deleted")
      loadLocations()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't delete location")
    }
  }

  async function handleCreateTopLevel() {
    if (!newTopLevelName.trim()) return
    setCreatingTopLevel(true)
    const ok = await handleCreate(newTopLevelName.trim(), null)
    setCreatingTopLevel(false)
    if (ok) setNewTopLevelName("")
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  const tree = buildTree(locations)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage your own warehouse storage structure, sites, rooms, shelves, racks, slots, used for tracking where company-owned Inventory stock physically sits. Unlike Categories, location names don&apos;t need to be unique across the tree.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={newTopLevelName}
          onChange={(e) => setNewTopLevelName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTopLevel()}
          placeholder="e.g. Main HQ, Warehouse B"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handleCreateTopLevel} disabled={creatingTopLevel || !newTopLevelName.trim()}>
          {creatingTopLevel ? "Adding..." : "Add Location"}
        </Button>
      </div>

      <div className="space-y-1">
        {tree.map((node) => (
          <LocationTreeNode
            key={node.id}
            node={node}
            depth={0}
            onCreateChild={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        ))}
        {tree.length === 0 && (
          <p className="text-sm text-muted-foreground">No locations yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}

function LocationTreeNode({
  node,
  depth,
  onCreateChild,
  onRename,
  onDelete,
}: {
  node: LocationTreeItem
  depth: number
  onCreateChild: (name: string, parentId: string | null) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (location: Location) => void
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
                onClick={() => setAddingChild((v) => !v)}
                title="Add sub-location"
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
            placeholder="Sub-location name"
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
            <LocationTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}