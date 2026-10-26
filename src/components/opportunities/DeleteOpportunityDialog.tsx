"use client"

import { useState } from "react"
import { AlertDialog } from "@heroui/react"
import { Button } from "@/components/ui/button"

// The delete confirmation, styled like the shared confirmDialog (danger
// variant). It stays its own dialog because a refused delete (409, the
// opportunity is linked to quotes or orders) must show the API's message
// inside the dialog, and confirmDialog closes as soon as it is answered.
export function DeleteOpportunityDialog({
  opportunity,
  onCancel,
  onDelete,
}: {
  opportunity: { number: string; title: string }
  onCancel: () => void
  // Resolves to null once deleted, or the message to show
  onDelete: () => Promise<string | null>
}) {
  const [isOpen, setIsOpen] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (deleting) return
    setIsOpen(false)
    onCancel()
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    const message = await onDelete()
    setDeleting(false)
    if (message) setError(message)
  }

  return (
    <AlertDialog.Root
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <AlertDialog.Backdrop isDismissable={!deleting} isKeyboardDismissDisabled={deleting}>
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog className="bg-popover text-popover-foreground border border-border rounded-lg shadow-popover p-6">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" className="bg-danger/10 text-danger" />
              <AlertDialog.Heading level={2} className="text-lg font-bold text-foreground">
                Delete {opportunity.number}?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3 text-muted-foreground">
              <p>
                &quot;{opportunity.title}&quot; and its attachments will be deleted. This can&apos;t be undone.
              </p>
              {error && (
                <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex-wrap">
              <Button variant="outline" onClick={close} disabled={deleting}>
                {error ? "Close" : "Cancel"}
              </Button>
              {!error && (
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              )}
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog.Root>
  )
}
