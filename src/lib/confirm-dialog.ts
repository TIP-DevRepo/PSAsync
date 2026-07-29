"use client"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** "danger" renders the confirm button in the destructive/red style —
   *  use for anything that deletes or otherwise can't be undone. */
  variant?: "default" | "danger"
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

let dispatch: ((state: ConfirmState | null) => void) | null = null

export function registerConfirmDialog(fn: (state: ConfirmState | null) => void) {
  dispatch = fn
}

// Drop-in async replacement for window.confirm(). Accepts either a plain
// string (used as the title) or a full options object for a description,
// custom button labels, and the danger styling used on delete actions.
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === "string" ? { title: options } : options
  return new Promise((resolve) => {
    if (!dispatch) {
      // Provider hasn't mounted yet somehow — fall back rather than hang
      resolve(window.confirm(opts.title))
      return
    }
    dispatch({ ...opts, resolve })
  })
}