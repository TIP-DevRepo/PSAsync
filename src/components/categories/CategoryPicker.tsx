"use client"

import { useState, useEffect, useMemo } from "react"

interface CategoryOption {
  id: string
  name: string
  parentId: string | null
  defaultIsSerialized: boolean
}

// Shared two-level category picker. A CatalogItem's categoryId can point
// at either a top-level Category or a child one — picking a subcategory
// is optional. Used on both the Add and Edit Catalog Item forms.
//
// onDefaultsChange is optional — pass it (Add Catalog Item form only) to
// get notified of the picked category's defaultIsSerialized value so the
// form can auto-check its own Serialized box. Edit forms should leave
// this off, so opening an existing item never silently overrides its
// already-saved value.
export function CategoryPicker({
  value,
  onChange,
  onDefaultsChange,
}: {
  value: string
  onChange: (categoryId: string) => void
  onDefaultsChange?: (defaults: { isSerialized: boolean }) => void
}) {
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        setCategories(data)
        setLoading(false)
      })
  }, [])

  const topLevel = useMemo(
    () => categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  )

  // Work out which top-level category the current value belongs to, and
  // whether that value is actually a subcategory underneath it.
  const selected = useMemo(() => {
    if (!value) return { topId: "", subId: "" }
    const direct = categories.find((c) => c.id === value)
    if (!direct) return { topId: "", subId: "" }
    if (!direct.parentId) return { topId: direct.id, subId: "" }
    return { topId: direct.parentId, subId: direct.id }
  }, [value, categories])

  const children = useMemo(
    () => categories.filter((c) => c.parentId === selected.topId).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, selected.topId]
  )

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading categories...</p>
  }

  function handleTopChange(topId: string) {
    onChange(topId)
    const picked = categories.find((c) => c.id === topId)
    if (picked && onDefaultsChange) onDefaultsChange({ isSerialized: picked.defaultIsSerialized })
  }

  function handleSubChange(subId: string) {
    const resolvedId = subId || selected.topId
    onChange(resolvedId)
    const picked = categories.find((c) => c.id === resolvedId)
    if (picked && onDefaultsChange) onDefaultsChange({ isSerialized: picked.defaultIsSerialized })
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium mb-1">Category *</label>
        <select
          value={selected.topId}
          onChange={(e) => handleTopChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select a category</option>
          {topLevel.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Subcategory</label>
        <select
          value={selected.subId}
          onChange={(e) => handleSubChange(e.target.value)}
          disabled={!selected.topId || children.length === 0}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">None</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}