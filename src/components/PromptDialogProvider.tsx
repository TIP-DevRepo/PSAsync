"use client"

import { useEffect, useRef, useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { registerPromptDialog, type PromptState } from "@/lib/prompt-dialog"

export function PromptDialogProvider() {
  const [state, setState] = useState<PromptState | null>(null)
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    registerPromptDialog((s) => {
      setState(s)
      setValue(s?.defaultValue ?? "")
    })
  }, [])

  useEffect(() => {
    if (state) {
      // Focus the input the moment the dialog mounts, so typing can start
      // immediately without an extra click
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [state])

  if (!state) return null

  function respond(result: string | null) {
    state!.resolve(result)
    setState(null)
  }

  function handleConfirm() {
    respond(value.trim() || null)
  }

  return (
    <Modal maxWidth="sm" onClose={() => respond(null)}>
      <h2 className="text-lg font-bold text-foreground">{state.title}</h2>
      {state.description && (
        <p className="text-sm text-muted-foreground">{state.description}</p>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm()
          if (e.key === "Escape") respond(null)
        }}
        placeholder={state.placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => respond(null)}>
          {state.cancelLabel ?? "Cancel"}
        </Button>
        <Button onClick={handleConfirm} disabled={!value.trim()}>
          {state.confirmLabel ?? "Save"}
        </Button>
      </div>
    </Modal>
  )
}