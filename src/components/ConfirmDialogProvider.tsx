"use client"

import { useEffect, useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { registerConfirmDialog, type ConfirmState } from "@/lib/confirm-dialog"

export function ConfirmDialogProvider() {
  const [state, setState] = useState<ConfirmState | null>(null)

  useEffect(() => {
    registerConfirmDialog(setState)
  }, [])

  if (!state) return null

  function respond(result: boolean) {
    state!.resolve(result)
    setState(null)
  }

  return (
    <Modal maxWidth="sm" onClose={() => respond(false)}>
      <h2 className="text-lg font-bold text-foreground">{state.title}</h2>
      {state.description && (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{state.description}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => respond(false)}>
          {state.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          variant={state.variant === "danger" ? "destructive" : "default"}
          onClick={() => respond(true)}
        >
          {state.confirmLabel ?? "Confirm"}
        </Button>
      </div>
    </Modal>
  )
}