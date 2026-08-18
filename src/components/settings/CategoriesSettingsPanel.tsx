"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Plus, Pencil, Trash2, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Category {
  id: string
  name: string
  parentId: string | null
}

interface CategoryTreeItem extends Category {
  children: CategoryTreeItem[]
}

function buildTree(flat: Category[]): CategoryTreeItem[] {
  const nodes = new Map<string, CategoryTreeItem>()
  flat.forEach((c) => nodes.set(c.id, { ...c, children: [] }))

  const roots: CategoryTreeItem[] = []
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortByName = (a: CategoryTreeItem, b: CategoryTreeItem) => a.name.localeCompare(b.name)
  const sortRecursive = (list: CategoryTreeItem[]) => {
    list.sort(sortByName)
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}

export function CategoriesSettingsPanel() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [newTopLevelName, setNewTopLevelName] = useState("")
  const [creatingTopLevel, setCreatingTopLevel] = useState(false)

  function loadCategories() {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        setCategories(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadCategories()
  }, [])

  async function handleCreate(name: string, parentId: string | null) {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    })
    if (res.ok) {
      toast.success(parentId ? "Subcategory added" : "Category added")
      loadCategories()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't add category")
      return false
    }
  }

  async function handleRename(id: string, name: string) {
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      toast.success("Category renamed")
      loadCategories()
      return true
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't rename category")
      return false
    }
  }

  async function handleDelete(category: Category) {
    const confirmed = await confirmDialog({
      title: `Delete "${category.name}"?`,
      description: "This can't be undone. Categories with subcategories or catalog items still attached can't be deleted, move or reassign those first.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/categories/${category.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Category deleted")
      loadCategories()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't delete category")
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

  const tree = buildTree(categories)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the categories used across your Catalog and Inventory. Every catalog item needs a category, subcategories are optional. Category names must be unique across your whole company, even under different parents.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={newTopLevelName}
          onChange={(e) => setNewTopLevelName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateTopLevel()}
          placeholder="e.g. Networking, Non-Serialized"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handleCreateTopLevel} disabled={creatingTopLevel || !newTopLevelName.trim()}>
          {creatingTopLevel ? "Adding..." : "Add Category"}
        </Button>
      </div>

      <div className="space-y-1">
        {tree.map((node) => (
          <CategoryTreeNode
            key={node.id}
            node={node}
            depth={0}
            onCreateChild={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        ))}
        {tree.length === 0 && (
          <p className="text-sm text-muted-foreground">No categories yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}

function CategoryTreeNode({
  node,
  depth,
  onCreateChild,
  onRename,
  onDelete,
}: {
  node: CategoryTreeItem
  depth: number
  onCreateChild: (name: string, parentId: string | null) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (category: Category) => void
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
                title="Add subcategory"
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
            placeholder="Subcategory name"
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
            <CategoryTreeNode
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