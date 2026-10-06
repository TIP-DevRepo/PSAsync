"use client"

import { useEffect, useState } from "react"
import { AlertDialog } from "@heroui/react"
import { Button } from "@/components/ui/button"
import { registerConfirmDialog, type ConfirmState } from "@/lib/confirm-dialog"

// Built on HeroUI's AlertDialog, which traps focus inside the dialog and
// returns it to whatever opened it on close. The last request is kept in
// state after closing so its content stays put during the exit animation.
export function ConfirmDialogProvider() {
  const [state, setState] = useState<ConfirmState | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    registerConfirmDialog((next) => {
      setState(next)
      setIsOpen(next !== null)
    })
  }, [])

  if (!state) return null

  function respond(result: boolean) {
    // Ignore clicks that land during the exit animation
    if (!isOpen) return
    state!.resolve(result)
    setIsOpen(false)
  }

  const isDanger = state.variant === "danger"

  return (
    <AlertDialog.Root
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) respond(false)
      }}
    >
      <AlertDialog.Backdrop isDismissable isKeyboardDismissDisabled={false}>
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog className="bg-popover text-popover-foreground border border-border rounded-lg shadow-popover p-6">
            <AlertDialog.Header>
              {isDanger && <AlertDialog.Icon status="danger" className="bg-danger/10 text-danger" />}
              <AlertDialog.Heading level={2} className="text-lg font-bold text-foreground">
                {state.title}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            {state.description && (
              <AlertDialog.Body className="text-muted-foreground whitespace-pre-line">
                {state.description}
              </AlertDialog.Body>
            )}
            <AlertDialog.Footer className="flex-wrap">
              <Button variant="outline" onClick={() => respond(false)}>
                {state.cancelLabel ?? "Cancel"}
              </Button>
              <Button variant={isDanger ? "destructive" : "default"} onClick={() => respond(true)}>
                {state.confirmLabel ?? "Confirm"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog.Root>
  )
}
