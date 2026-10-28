"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
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

// A role a user holds because a team they are in gives it (GET /api/users
// teamRoles), with the teams it comes from
export interface TeamGrantedRole extends AssignableRole {
  teams: { id: string; name: string }[]
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

// The tooltip of a team granted role: where it comes from, and for a role
// only a team gives, how to take it away (Manage Users can't)
export function teamRoleNote(role: TeamGrantedRole, alsoDirect: boolean): string {
  const from = `team${role.teams.length === 1 ? "" : "s"} ${listNames(role.teams.map((t) => t.name))}`
  return alsoDirect
    ? `Given directly and from ${from}`
    : `From ${from}. Remove the user from the team to take this role away.`
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
//
// teamRoles are roles the user holds through their teams. They show among
// the pills once (a role also given directly is marked as both), with a
// team icon and a tooltip, and can't be removed here: in the checklist a
// role only a team gives is ticked and disabled.
//
// With showEditButton off, only the pills show. That's for rows where the
// checklist is opened from somewhere else, like the Users table's row menu,
// which renders RoleChecklist itself.
export function RoleAssignControl({
  roles,
  selectedIds,
  onChange,
  disabledReason,
  lockedReason,
  busy = false,
  label,
  collapsible = false,
  showEditButton = true,
  teamRoles = [],
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
  showEditButton?: boolean
  teamRoles?: TeamGrantedRole[]
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

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

  const selectedSet = new Set(selectedIds)
  const teamRoleById = new Map(teamRoles.map((r) => [r.id, r]))
  // Highest rank first, so Global Admin (rank 999999) always leads when
  // held. Each role once, whether given directly, by a team, or both.
  const heldRoles = [
    ...roles.filter((r) => selectedSet.has(r.id)),
    ...teamRoles.filter((r) => !selectedSet.has(r.id)),
  ].sort((a, b) => b.rank - a.rank)
  const noteFor = (role: AssignableRole) => {
    const team = teamRoleById.get(role.id)
    return team ? teamRoleNote(team, selectedSet.has(role.id)) : undefined
  }

  const canCollapse = collapsible && heldRoles.length > 0
  const collapsed = canCollapse && !expanded
  const visibleRoles = collapsed ? heldRoles.slice(0, COLLAPSED_PILL_COUNT) : heldRoles
  // Everyone is hidden in the collapsed view unless it's the only role
  const showEveryone = !collapsed
  const hiddenCount = collapsed ? heldRoles.length - visibleRoles.length + 1 : 0

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visibleRoles.map((role) => (
        <RolePill key={role.id} role={role} teamNote={noteFor(role)} />
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
        showEditButton && (
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
        )
      )}

      {showEditButton && (
        <RoleChecklist
          open={open}
          anchor={anchor}
          triggerRef={buttonRef}
          onClose={() => setOpen(false)}
          roles={roles}
          selectedIds={selectedIds}
          onChange={onChange}
          disabledReason={disabledReason}
          busy={busy}
          label={label}
          teamRoles={teamRoles}
        />
      )}
    </div>
  )
}

// The role checklist popover on its own, positioned with the fixed menu
// hooks below anchor so a scrolling table never clips it. Clicking
// outside it or scrolling closes it; Escape closes it and returns focus to
// triggerRef. Clicks on triggerRef don't count as outside, so the trigger
// can toggle it. autoFocus moves focus to the first role that can be
// changed once it's visible, for triggers that sit after the popover in
// tab order (like a row menu).
export function RoleChecklist({
  open,
  anchor,
  triggerRef,
  onClose,
  roles,
  selectedIds,
  onChange,
  disabledReason,
  busy = false,
  label,
  autoFocus = false,
  teamRoles = [],
}: {
  open: boolean
  anchor: MenuAnchor | null
  triggerRef: RefObject<HTMLElement | null>
  onClose: () => void
  // Every assignable role (never Everyone), highest rank first
  roles: AssignableRole[]
  selectedIds: string[]
  onChange: (nextIds: string[]) => void
  disabledReason: (role: AssignableRole) => string | null
  busy?: boolean
  label: string
  autoFocus?: boolean
  // Roles the user's teams give them (see RoleAssignControl)
  teamRoles?: TeamGrantedRole[]
}) {
  const { menuRef, style: menuStyle } = useFixedMenuPosition(open, anchor)

  useCloseOnOutsideClick(open, [menuRef, triggerRef], onClose)
  useCloseOnScroll(open, onClose)

  // Escape closes the checklist and hands focus back to the trigger
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onClose, triggerRef])

  const isVisible = menuStyle.visibility === "visible"
  useEffect(() => {
    if (!open || !autoFocus || !isVisible) return
    // preventScroll so focusing can't trigger useCloseOnScroll and shut it
    menuRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus({ preventScroll: true })
  }, [open, autoFocus, isVisible, menuRef])

  if (!open) return null

  const selectedSet = new Set(selectedIds)
  const teamRoleById = new Map(teamRoles.map((r) => [r.id, r]))

  function toggleRole(roleId: string, checked: boolean) {
    onChange(checked ? [...selectedIds, roleId] : selectedIds.filter((id) => id !== roleId))
  }

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      role="dialog"
      aria-label={label}
      className="z-50 w-64 max-h-80 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-popover"
    >
      {roles.length === 0 && <p className="px-3 py-2 text-muted-foreground">No roles to assign yet.</p>}
      {roles.map((role) => {
        const team = teamRoleById.get(role.id)
        const direct = selectedSet.has(role.id)
        // Only a team gives it: shown held, and removed only by leaving the team
        const teamOnly = !!team && !direct
        const reason = teamOnly ? teamRoleNote(team, false) : disabledReason(role)
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
              checked={direct || teamOnly}
              disabled={isDisabled}
              onChange={(e) => toggleRole(role.id, e.target.checked)}
            />
            <span className="min-w-0">
              <RolePill role={role} teamNote={team ? teamRoleNote(team, direct) : undefined} />
              {reason && <span className="mt-0.5 block text-caption text-muted-foreground">{reason}</span>}
              {team && direct && <span className="mt-0.5 block text-caption text-muted-foreground">{teamRoleNote(team, true)}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}
