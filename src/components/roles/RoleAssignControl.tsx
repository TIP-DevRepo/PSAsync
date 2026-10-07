"use client"

import { useEffect, useRef, useState } from "react"
import { Lock } from "lucide-react"
import { RolePill } from "@/components/roles/RolePill"
import { useFixedMenuPosition, useCloseOnOutsideClick, useCloseOnScroll, type MenuAnchor } from "@/lib/useFixedMenu"

export interface AssignableRole {
  id: string
  name: string
  rank: number
  color: string | null
  isGlobalAdmin?: boolean
}

// The Everyone pill every user shows. Everyone is held implicitly by every
// user, so it is always displayed, locked, and never in the checklist.
const EVERYONE_PILL = { name: "Everyone", isEveryone: true }

// How many role pills a collapsed row shows before "+N more"
const COLLAPSED_PILL_COUNT = 2

// Shows a user's roles as pills, highest rank first with Everyone (locked)
// last, plus a button that opens a checklist popover for toggling roles on
// and off. Every toggle calls onChange with the full new set of role ids.
// Roles the acting user can't hand out are listed disabled with
// disabledReason's short reason; the server's rank rules are still the real
// enforcement.
//
// With collapsible, only the two highest roles show and everything else,
// Everyone included, sits behind a "+N more" button that expands the pills
// in place (wrapping onto more lines, never widening the container). A user
// with no assigned roles just shows Everyone. Expanded state is in memory
// only, so a reload collapses it again.
export function RoleAssignControl({
  roles,
  selectedIds,
  onChange,
  disabledReason,
  lockedReason,
  busy = false,
  label,
  collapsible = false,
}: {
  // Every assignable role (never Everyone), highest rank first
  roles: AssignableRole[]
  selectedIds: string[]
  onChange: (nextIds: string[]) => void
  disabledReason: (role: AssignableRole) => string | null
  // When set, the whole control is read only (e.g. the user outranks you)
  lockedReason?: string | null
  busy?: boolean
  // Accessible name for the edit button, e.g. "Edit roles for Jane"
  label: string
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { menuRef, style: menuStyle } = useFixedMenuPosition(open, anchor)

  useCloseOnOutsideClick(open, [menuRef, buttonRef], () => setOpen(false))
  useCloseOnScroll(open, () => setOpen(false))

  // Escape closes the checklist and hands focus back to the button
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  function toggleOpen() {
    if (open) {
      setOpen(false)
      return
    }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
    }
    setOpen(true)
  }

  function toggleRole(roleId: string, checked: boolean) {
    onChange(checked ? [...selectedIds, roleId] : selectedIds.filter((id) => id !== roleId))
  }

  const selectedSet = new Set(selectedIds)
  // Highest rank first, so Global Admin (rank 999999) always leads when held
  const heldRoles = roles.filter((r) => selectedSet.has(r.id)).sort((a, b) => b.rank - a.rank)

  const canCollapse = collapsible && heldRoles.length > 0
  const collapsed = canCollapse && !expanded
  const visibleRoles = collapsed ? heldRoles.slice(0, COLLAPSED_PILL_COUNT) : heldRoles
  // Everyone is hidden in the collapsed view unless it's the only role
  const showEveryone = !collapsed
  const hiddenCount = collapsed ? heldRoles.length - visibleRoles.length + 1 : 0

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visibleRoles.map((role) => (
        <RolePill key={role.id} role={role} />
      ))}
      {showEveryone && <RolePill role={EVERYONE_PILL} locked />}

      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2 text-caption font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {expanded ? (
            <>
              Show less<span className="sr-only"> roles</span>
            </>
          ) : (
            <>
              +{hiddenCount} more<span className="sr-only"> {hiddenCount === 1 ? "role" : "roles"}</span>
            </>
          )}
        </button>
      )}

      {lockedReason ? (
        <span title={lockedReason} className="inline-flex items-center text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          <span className="sr-only">{lockedReason}</span>
        </span>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          disabled={busy}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex h-6 items-center gap-0.5 whitespace-nowrap rounded-full border border-dashed border-border px-2 text-caption text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Edit Roles
        </button>
      )}

      {open && (
        <div
          ref={menuRef}
          style={menuStyle}
          role="dialog"
          aria-label={label}
          className="z-50 w-64 max-h-80 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-popover"
        >
          {roles.length === 0 && <p className="px-3 py-2 text-muted-foreground">No roles to assign yet.</p>}
          {roles.map((role) => {
            const reason = disabledReason(role)
            const isDisabled = !!reason || busy
            return (
              <label
                key={role.id}
                className={`flex items-start gap-2 px-3 py-2 ${
                  reason ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-hover"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedSet.has(role.id)}
                  disabled={isDisabled}
                  onChange={(e) => toggleRole(role.id, e.target.checked)}
                />
                <span className="min-w-0">
                  <RolePill role={role} />
                  {reason && <span className="mt-0.5 block text-caption text-muted-foreground">{reason}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
