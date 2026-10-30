"use client"

import {
  CalendarDays,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Flag,
  Mail,
  Phone,
  Send,
  SquareCheck,
  Star,
  StickyNote,
  Ticket,
  TriangleAlert,
  Trophy,
  User,
  type LucideIcon,
} from "lucide-react"
import { buttonTextColor, type ActionButtonDefinition, type ActionButtonIcon } from "@/lib/timeline-buttons"
import { cn } from "@/lib/utils"

export const ACTION_BUTTON_ICON_COMPONENTS: Record<ActionButtonIcon, LucideIcon> = {
  note: StickyNote,
  email: Mail,
  won: Trophy,
  lost: CircleX,
  call: Phone,
  meeting: CalendarDays,
  task: SquareCheck,
  quote: FileText,
  ticket: Ticket,
  flag: Flag,
  star: Star,
  clock: Clock,
  check: CircleCheck,
  alert: TriangleAlert,
  user: User,
  send: Send,
}

// One button as it shows on a record: a rounded pill filled with the
// button's color, its text white or near black for contrast. Also the live
// preview in Settings > Action Buttons.
export function ActionButtonPill({
  label,
  icon,
  color,
  pressed = false,
  unavailableReason = null,
  onClick,
  as = "button",
}: {
  label: string
  icon: ActionButtonIcon
  color: string
  pressed?: boolean
  // Shown as the tooltip of a button that can't be used; the button stays
  // focusable so the reason can be read
  unavailableReason?: string | null
  onClick?: () => void
  // "span" for a preview that isn't a control
  as?: "button" | "span"
}) {
  const Icon = ACTION_BUTTON_ICON_COMPONENTS[icon] ?? StickyNote
  const style = { backgroundColor: color, borderColor: color, color: buttonTextColor(color) }
  const className = cn(
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[filter] duration-100",
    as === "button" &&
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    as === "button" && !unavailableReason && "hover:brightness-110",
    unavailableReason && "cursor-not-allowed opacity-50",
    pressed && "ring-2 ring-ring ring-offset-2 ring-offset-background"
  )
  const content = (
    <>
      <Icon size={15} aria-hidden="true" />
      {label}
    </>
  )
  if (as === "span") {
    return (
      <span className={className} style={style}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (!unavailableReason) onClick?.()
      }}
      aria-disabled={unavailableReason ? true : undefined}
      aria-pressed={pressed}
      title={unavailableReason ?? undefined}
      className={className}
      style={style}
    >
      {content}
    </button>
  )
}

// A row of rounded pill buttons with an icon, styled like HaloPSA's action
// bar, from the company's button definitions (GET /api/action-buttons,
// src/lib/timeline-buttons.ts). Wraps onto more lines at narrow widths;
// buttons keep their size. A button unavailableReason names a reason for
// is shown dimmed with that reason as its tooltip and does nothing.
export function ActionButtonBar({
  buttons,
  onSelect,
  activeId,
  unavailableReason,
  label = "Actions",
}: {
  buttons: readonly ActionButtonDefinition[]
  onSelect: (button: ActionButtonDefinition) => void
  // The button whose composer is open, shown as pressed
  activeId?: string | null
  unavailableReason?: (button: ActionButtonDefinition) => string | null
  label?: string
}) {
  if (buttons.length === 0) return null
  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap gap-2">
      {buttons.map((button) => (
        <ActionButtonPill
          key={button.id}
          label={button.label}
          icon={button.icon}
          color={button.color}
          pressed={activeId === button.id}
          unavailableReason={unavailableReason?.(button) ?? null}
          onClick={() => onSelect(button)}
        />
      ))}
    </div>
  )
}
