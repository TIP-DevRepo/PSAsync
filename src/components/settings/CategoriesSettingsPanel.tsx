"use client"

import { useState, useEffect, useMemo } from "react"
import { ChevronRight, Plus, Pencil, Trash2, Check, X, ListPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Category {
  id: string
  name: string
  parentId: string | null
  defaultIsSerialized: boolean
}

interface CategoryTreeItem extends Category {
  children: CategoryTreeItem[]
}

interface CustomField {
  id: string
  name: string
  categoryId: string
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
  const [fields, setFields] = useState<CustomField[]>([])
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

  function loadFields() {
    fetch("/api/inventory-custom-fields")
      .then((res) => res.json())
      .then((data) => setFields(data))
  }

  useEffect(() => {
    loadCategories()
    loadFields()
  }, [])

  const fieldsByCategory = useMemo(() => {
    const map = new Map<string, CustomField[]>()
    fields.forEach((f) => {
      const list = map.get(f.categoryId) ?? []
      list.push(f)
      map.set(f.categoryId, list)
    })
    return map
  }, [fields])

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

  async function handleToggleDefaultSerialized(id: string, value: boolean) {
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultIsSerialized: value }),
    })
    if (res.ok) {
      toast.success("Category default updated")
      loadCategories()
    } else {
      toast.error("Couldn't update category default")
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
        Manage the categories used across your Catalog and Inventory. Every catalog item needs a category, subcategories are optional. Category names must be unique across your whole company, even under different parents. Custom fields (for Inventory only) can be added per category, an asset inherits fields from both its own category and every parent category above it, so field names must also be unique across that whole chain.
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
            fieldsByCategory={fieldsByCategory}
            onCreateChild={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
            onFieldsChanged={loadFields}
            onToggleDefaultSerialized={handleToggleDefaultSerialized}
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
  fieldsByCategory,
  onCreateChild,
  onRename,
  onDelete,
  onFieldsChanged,
  onToggleDefaultSerialized,
}: {
  node: CategoryTreeItem
  depth: number
  fieldsByCategory: Map<string, CustomField[]>
  onCreateChild: (name: string, parentId: string | null) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (category: Category) => void
  onFieldsChanged: () => void
  onToggleDefaultSerialized: (id: string, value: boolean) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [addingChild, setAddingChild] = useState(false)
  const [childName, setChildName] = useState("")
  const [savingChild, setSavingChild] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const [savingRename, setSavingRename] = useState(false)
  const [managingFields, setManagingFields] = useState(false)

  const ownFields = fieldsByCategory.get(node.id) ?? []

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
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-foreground truncate">{node.name}</span>
              {ownFields.length > 0 && (
                <span
                  title={`${ownFields.length} custom field${ownFields.length === 1 ? "" : "s"}`}
                  className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  {ownFields.length} field{ownFields.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
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
                onClick={() => setManagingFields((v) => !v)}
                title="Manage custom fields"
                className={managingFields ? "text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                <ListPlus size={14} />
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

      {managingFields && (
        <div style={{ marginLeft: (depth + 1) * 20 }} className="mt-1 space-y-2">
          <div className="rounded-md border border-border bg-card/50 p-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={node.defaultIsSerialized}
                onChange={(e) => onToggleDefaultSerialized(node.id, e.target.checked)}
                className="accent-primary"
              />
              Default new items in this category to Serialized
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Only affects the checkbox when creating a new Catalog Item under this category, existing items are never changed.
            </p>
          </div>
          <CategoryFieldsPanel
            categoryId={node.id}
            categoryName={node.name}
            fields={ownFields}
            onChanged={onFieldsChanged}
          />
        </div>
      )}

      {expanded && node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              fieldsByCategory={fieldsByCategory}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onFieldsChanged={onFieldsChanged}
              onToggleDefaultSerialized={onToggleDefaultSerialized}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryFieldsPanel({
  categoryId,
  categoryName,
  fields,
  onChanged,
}: {
  categoryId: string
  categoryName: string
  fields: CustomField[]
  onChanged: () => void
}) {
  const [newFieldName, setNewFieldName] = useState("")
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")

  async function handleAdd() {
    if (!newFieldName.trim()) return
    setAdding(true)
    const res = await fetch(`/api/categories/${categoryId}/custom-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFieldName.trim() }),
    })
    setAdding(false)
    if (res.ok) {
      toast.success("Field added")
      setNewFieldName("")
      onChanged()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't add field")
    }
  }

  async function handleRename(id: string) {
    if (!editValue.trim()) return
    const res = await fetch(`/api/inventory-custom-fields/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValue.trim() }),
    })
    if (res.ok) {
      toast.success("Field renamed")
      setEditingId(null)
      onChanged()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Couldn't rename field")
    }
  }

  async function handleDelete(field: CustomField) {
    const confirmed = await confirmDialog({
      title: `Delete "${field.name}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/inventory-custom-fields/${field.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Field deleted")
      onChanged()
    } else {
      toast.error("Couldn't delete field")
    }
  }

  return (
    <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Custom fields for &quot;{categoryName}&quot;</p>

      <div className="space-y-1">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between rounded border border-border bg-background px-2 py-1.5 text-sm">
            {editingId !== field.id ? (
              <span className="text-foreground">{field.name}</span>
            ) : (
              <input
                autoFocus
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename(field.id)}
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            <div className="flex items-center gap-2">
              {editingId !== field.id ? (
                <>
                  <button
                    onClick={() => { setEditingId(field.id); setEditValue(field.name) }}
                    title="Rename"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(field)}
                    title="Delete"
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => handleRename(field.id)} title="Save" className="text-success hover:opacity-80">
                    <Check size={13} />
                  </button>
                  <button onClick={() => setEditingId(null)} title="Cancel" className="text-muted-foreground hover:text-foreground">
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground">No custom fields yet.</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <input
          type="text"
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="New field name (e.g. MAC Address)"
          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="sm" onClick={handleAdd} disabled={adding || !newFieldName.trim()}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>
    </div>
  )
}