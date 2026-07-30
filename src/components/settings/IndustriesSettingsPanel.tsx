"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Industry {
  id: string
  name: string
}

export function IndustriesSettingsPanel() {
  const [industries, setIndustries] = useState<Industry[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  function loadIndustries() {
    fetch("/api/industries")
      .then((res) => res.json())
      .then((data) => {
        setIndustries(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadIndustries()
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch("/api/industries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    setCreating(false)
    if (res.ok) {
      toast.success("Industry added")
      setNewName("")
      loadIndustries()
    } else {
      toast.error("Couldn't add industry")
    }
  }

  async function handleDelete(industry: Industry) {
    const confirmed = await confirmDialog({
      title: `Delete "${industry.name}"?`,
      description: "Clients currently set to this industry will just have it cleared, not deleted.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    const res = await fetch(`/api/industries/${industry.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Industry deleted")
      loadIndustries()
    } else {
      toast.error("Couldn't delete industry")
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage the list of industries available when setting a client's industry. New ones can
        also be added directly from a client's Details tab.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="e.g. Healthcare, Manufacturing"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? "Adding..." : "Add"}
        </Button>
      </div>

      <div className="space-y-1">
        {industries.map((ind) => (
          <div
            key={ind.id}
            className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <span className="text-foreground">{ind.name}</span>
            <button
              onClick={() => handleDelete(ind)}
              className="text-xs text-muted-foreground hover:text-danger"
            >
              Delete
            </button>
          </div>
        ))}
        {industries.length === 0 && (
          <p className="text-sm text-muted-foreground">No industries yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}