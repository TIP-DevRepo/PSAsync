"use client"

import { useEffect, useRef, useState } from "react"
import { AlertDialog } from "@heroui/react"
import { Button } from "@/components/ui/button"
import { registerPromptDialog, type PromptState } from "@/lib/prompt-dialog"

// Built on HeroUI's AlertDialog, the same way ConfirmDialogProvider is, so
// focus is trapped inside while it's open and returned to whatever opened it
// on close. Escape and a backdrop click cancel, Enter submits. The last
// request is kept in state after closing so its content stays put during the
// exit animation.
export function PromptDialogProvider() {
  const [state, setState] = useState<PromptState | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    registerPromptDialog((next) => {
      setState(next)
      setValue(next?.defaultValue ?? "")
      setIsOpen(next !== null)
    })
  }, [])

  // Focus the input and select any default text once the dialog has
  // mounted, so typing replaces it straight away
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(id)
  }, [isOpen])

  if (!state) return null

  function respond(result: string | null) {
    // Ignore anything that lands during the exit animation
    if (!isOpen) return
    state!.resolve(result)
    setIsOpen(false)
  }

  const trimmed = value.trim()
  const canSubmit = state.allowEmpty || trimmed.length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    respond(state!.allowEmpty ? trimmed : trimmed || null)
  }

  return (
    <AlertDialog.Root
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) respond(null)
      }}
    >
      <AlertDialog.Backdrop isDismissable isKeyboardDismissDisabled={false}>
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog className="bg-popover text-popover-foreground border border-border rounded-lg shadow-popover p-6">
            <form onSubmit={handleSubmit}>
              <AlertDialog.Header>
                <AlertDialog.Heading level={2} className="text-lg font-bold text-foreground">
                  {state.title}
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="space-y-3">
                {state.description && <p className="text-muted-foreground">{state.description}</p>}
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={state.placeholder}
                  aria-label={state.title}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer className="flex-wrap">
                <Button type="button" variant="outline" onClick={() => respond(null)}>
                  {state.cancelLabel ?? "Cancel"}
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {state.confirmLabel ?? "Save"}
                </Button>
              </AlertDialog.Footer>
            </form>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog.Root>
  )
}
