"use client"

import { CalendarDays, CircleX, Mail, Phone, SquareCheck, StickyNote, Trophy, type LucideIcon } from "lucide-react"
import type { ActionButtonColor, ActionButtonDefinition, ActionButtonIcon } from "@/lib/timeline-buttons"
import { cn } from "@/lib/utils"

const ICONS: Record<ActionButtonIcon, LucideIcon> = {
  note: StickyNote,
  won: Trophy,
  lost: CircleX,
  email: Mail,
  call: Phone,
  meeting: CalendarDays,
  task: SquareCheck,
}

// Tinted pills in the brand and status tokens
const COLORS: Record<ActionButtonColor, string> = {
  neutral: "border-border bg-muted text-foreground hover:bg-surface-hover",
  primary: "border-brand-primary-500/25 bg-brand-primary-500/10 text-brand-primary-500 hover:bg-brand-primary-500/20",
  success: "border-success/25 bg-success/10 text-success hover:bg-success/20",
  danger: "border-danger/25 bg-danger/10 text-danger hover:bg-danger/20",
  warning: "border-warning/25 bg-warning/10 text-warning hover:bg-warning/20",
  info: "border-info/25 bg-info/10 text-info hover:bg-info/20",
}

// A row of rounded pill buttons with an icon, styled like HaloPSA's action
// bar, from a list of button definitions (src/lib/timeline-buttons.ts).
// Wraps onto more lines at narrow widths; buttons keep their size.
export function ActionButtonBar({
  buttons,
  onSelect,
  activeId,
  disabled = false,
  label = "Actions",
}: {
  buttons: readonly ActionButtonDefinition[]
  onSelect: (button: ActionButtonDefinition) => void
  // The button whose composer is open, shown as pressed
  activeId?: string | null
  disabled?: boolean
  label?: string
}) {
  if (buttons.length === 0) return null
  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap gap-2">
      {buttons.map((button) => {
        const Icon = ICONS[button.icon] ?? StickyNote
        return (
          <button
            key={button.id}
            type="button"
            onClick={() => onSelect(button)}
            disabled={disabled}
            aria-pressed={activeId === button.id}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
              COLORS[button.color] ?? COLORS.neutral,
              activeId === button.id && "ring-2 ring-current"
            )}
          >
            <Icon size={15} aria-hidden="true" />
            {button.label}
          </button>
        )
      })}
    </div>
  )
}
