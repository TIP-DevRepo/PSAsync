"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

// Same grid-template-rows expand/collapse technique as the Settings
// accordion — hidden by default, click the label to reveal.
export function CollapsibleField({
  label,
  children,
  defaultOpen = false,
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-foreground focus-visible:outline-none"
      >
        {label}
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}