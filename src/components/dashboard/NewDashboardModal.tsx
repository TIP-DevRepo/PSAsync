"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"

export function NewDashboardModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState("")

  return (
    <Modal maxWidth="sm" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">New Dashboard</h2>

      <div className="mt-4">
        <label className="block text-xs text-muted-foreground mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Dashboard"
          autoFocus
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create</Button>
      </div>
    </Modal>
  )
}
