"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface ContactTag {
  id: string
  name: string
}

export function ContactTagsSettingsPanel() {
  const [tags, setTags] = useState<ContactTag[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  function loadTags() {
    fetch("/api/contact-tags")
      .then((res) => res.json())
      .then((data) => {
        setTags(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadTags()
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch("/api/contact-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    setCreating(false)
    if (res.ok) {
      toast.success("Tag added")
      setNewName("")
      loadTags()
    } else {
      toast.error("Couldn't add tag")
    }
  }

  async function handleDelete(tag: ContactTag) {
    const confirmed = await confirmDialog({
      title: `Delete "${tag.name}"?`,
      description: "Contacts currently wearing this tag will just have it removed, not deleted.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/contact-tags/${tag.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Tag deleted")
      loadTags()
    } else {
      toast.error("Couldn't delete tag")
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the list of tags available when tagging a contact (e.g. Sales Contact, Tech
        Contact). A contact can have more than one tag at once.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="e.g. Sales Contact, Tech Contact"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? "Adding..." : "Add"}
        </Button>
      </div>

      <div className="space-y-1">
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <span className="text-foreground">{tag.name}</span>
            <button
              onClick={() => handleDelete(tag)}
              className="text-xs text-muted-foreground hover:text-danger"
            >
              Delete
            </button>
          </div>
        ))}
        {tags.length === 0 && (
          <p className="text-sm text-muted-foreground">No tags yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}