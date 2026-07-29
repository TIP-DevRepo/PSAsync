"use client"

export interface PromptOptions {
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface PromptState extends PromptOptions {
  resolve: (value: string | null) => void
}

let dispatch: ((state: PromptState | null) => void) | null = null

export function registerPromptDialog(fn: (state: PromptState | null) => void) {
  dispatch = fn
}

// Drop-in async replacement for window.prompt(). Returns the entered
// text, or null if cancelled/closed — same contract as window.prompt().
export function promptDialog(options: PromptOptions | string): Promise<string | null> {
  const opts: PromptOptions = typeof options === "string" ? { title: options } : options
  return new Promise((resolve) => {
    if (!dispatch) {
      resolve(window.prompt(opts.title, opts.defaultValue))
      return
    }
    dispatch({ ...opts, resolve })
  })
}