"use client"

import { useState, useEffect, useRef } from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordByteLength } from "@/lib/password-rules"
import { Requirement } from "@/components/account/ChangePasswordCard"
import { RoleAssignControl, RoleChecklist, type AssignableRole, type TeamGrantedRole } from "@/components/roles/RoleAssignControl"
import { Modal } from "@/components/Modal"
import { SearchableChecklist } from "@/components/teams/SearchableChecklist"
import { useAccess } from "@/components/AccessProvider"
import { memberChangeBlockReason, type TeamSummary } from "@/lib/team-rules"
import type { MenuAnchor } from "@/lib/useFixedMenu"
import { sortUsersByName } from "@/lib/user-picker"

interface RoleOption extends AssignableRole {
  isEveryone?: boolean
  // Why you can't give this role to anyone (the grant rule), or null
  grantRefusal?: string | null
}

// Excludes }{[]|\/><;:'"~`+=,.^ since those tend to cause trouble when a
// temp password gets copy-pasted into a URL, CSV, or shell command.
const TEMP_PASSWORD_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*()-_?"

// Every character here is one byte, so a password of MIN_PASSWORD_LENGTH
// always meets both the minimum and the 72 byte maximum
function generateTempPassword(length = MIN_PASSWORD_LENGTH): string {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (v) => TEMP_PASSWORD_CHARS[v % TEMP_PASSWORD_CHARS.length]).join("")
}

interface User {
  id: string
  name: string
  email: string
  active: boolean
  // Every role the user was given directly, highest rank first (never Everyone)
  roles: AssignableRole[]
  // The teams the user is in, and the roles those teams give them
  teams?: { id: string; name: string }[]
  teamRoles?: TeamGrantedRole[]
  // With the Teams permission: why you can't add or remove this user from a team
  teamChangeRefusal?: string | null
  // Only sent to Global Admins, and only set while the login is locked
  loginLockedUntil?: string | null
}

export function UsersSettingsPanel() {
  const { can } = useAccess()
  // Changing a user's teams also needs the Teams permission
  const canManageTeams = can("settingsSections.teams")
  const [teams, setTeams] = useState<TeamSummary[]>([])
  // The user whose teams are being edited
  const [teamsUser, setTeamsUser] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  // Your own highest rank, the same number the server's hierarchy rules
  // use (Global Admin is effectively infinite). Null until it loads, which
  // keeps every role and user locked rather than briefly looking editable.
  const [myRank, setMyRank] = useState<number | null>(null)
  // Only a Global Admin sees login locks and can unlock them. The server
  // enforces this too, this only decides whether to show the button.
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false)
  // The signed in user's id, so their own row can't offer Deactivate
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [newUser, setNewUser] = useState({ name: "", email: "", tempPassword: "" })
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([])
  // The user whose roles are mid-save. Their checklist is disabled until it
  // finishes, so two quick toggles can't race and save out of order.
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  function loadUsers() {
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => {
        setUsers(Array.isArray(json) ? sortUsersByName(json as User[]) : json)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadUsers()
    fetch("/api/roles")
      .then((res) => res.json())
      // Everyone is held by every user implicitly, so it is never assignable
      .then((data: RoleOption[]) => setRoles(data.filter((r) => !r.isEveryone)))
    if (canManageTeams) {
      fetch("/api/teams")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => Array.isArray(data) && setTeams(data))
    }
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((session) => {
        const access = session?.user?.access
        setMyRank(access?.isGlobalAdmin ? Number.MAX_SAFE_INTEGER : access?.rank ?? 0)
        setIsGlobalAdmin(!!access?.isGlobalAdmin)
        setMyId(session?.user?.id ?? null)
      })
  }, [canManageTeams])

  // Same rules the users API enforces. Changing an existing user's roles
  // needs the user AND every role involved strictly below your own rank,
  // and a role the user doesn't hold yet must pass the grant rule (its
  // grantRefusal from GET /api/roles: you hold every permission it grants).
  // Removing a role needs no more than the rank.
  const grantRefusalOf = (role: AssignableRole) => roles.find((r) => r.id === role.id)?.grantRefusal ?? null
  function existingUserRoleReason(role: AssignableRole, user: User) {
    if (myRank === null || role.rank >= myRank) return "At or above your rank"
    if (!user.roles.some((r) => r.id === role.id)) return grantRefusalOf(role)
    return null
  }
  function inviteRoleReason(role: AssignableRole) {
    if (myRank === null || role.rank > myRank) return "Above your rank"
    return grantRefusalOf(role)
  }
  function userLockedReason(user: User) {
    // Roles from teams count toward the user's rank too
    const held = [...user.roles, ...(user.teamRoles ?? [])]
    const userRank = held.length > 0 ? Math.max(...held.map((r) => r.rank)) : 0
    if (myRank === null || userRank >= myRank) return "This user is at or above your rank, so you can't change their roles"
    return null
  }

  const tempPasswordLongEnough = newUser.tempPassword.length >= MIN_PASSWORD_LENGTH
  // Measured in bytes, matching the API
  const tempPasswordShortEnough =
    newUser.tempPassword.length > 0 && passwordByteLength(newUser.tempPassword) <= MAX_PASSWORD_BYTES
  const tempPasswordValid = tempPasswordLongEnough && tempPasswordShortEnough

  async function handleInvite() {
    if (!tempPasswordValid) return
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newUser, roleIds: inviteRoleIds }),
    })

    if (!res.ok) {
      const err = await res.json()
      toast.error("Couldn't invite user", err.error)
      return
    }

    toast.success(`Invited ${newUser.name || newUser.email}`)
    setNewUser({ name: "", email: "", tempPassword: "" })
    setInviteRoleIds([])
    setShowInvite(false)
    loadUsers()
  }

  // Saves a user's full role set as soon as a role is toggled. The pills
  // update right away and are corrected from the server either way.
  async function setUserRoles(user: User, nextIds: string[]) {
    const nextRoles = roles.filter((r) => nextIds.includes(r.id))
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, roles: nextRoles } : u)))
    setSavingUserId(user.id)
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleIds: nextIds }),
    })
    if (res.ok) {
      toast.success("Roles updated", user.name)
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error("Couldn't update roles", err.error)
    }
    setSavingUserId(null)
    loadUsers()
  }

  // Both directions change whether someone can sign in, so each asks first.
  // Cancel, Escape, or a backdrop click resolve false and nothing is sent.
  async function setUserActive(user: User, active: boolean) {
    const confirmed = await confirmDialog(
      active
        ? {
            title: `Activate ${user.name}?`,
            description: `${user.name} will be able to sign in again with the roles they hold.`,
            confirmLabel: "Activate User",
          }
        : {
            title: `Deactivate ${user.name}?`,
            description: `${user.name} will lose access immediately and will not be able to sign in until you activate them again. Their data is kept.`,
            confirmLabel: "Deactivate User",
            variant: "danger",
          }
    )
    if (!confirmed) return

    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    })
    if (res.ok) {
      toast.success(active ? "User activated" : "User deactivated")
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error("Couldn't update user", err.error)
    }
    loadUsers()
  }

  async function unlockUser(user: User) {
    const res = await fetch(`/api/users/${user.id}/unlock`, { method: "POST" })
    if (res.ok) {
      toast.success("User unlocked", user.name)
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error("Couldn't unlock user", err.error)
    }
    loadUsers()
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">Manage who has access and which roles they hold.</p>
        <Button onClick={() => setShowInvite(!showInvite)}>
          {showInvite ? "Cancel" : "Invite User"}
        </Button>
      </div>

      {roles.length === 0 && (
        <p className="text-xs text-amber-600">
          No roles found for your company yet. Something&apos;s wrong with your role setup, contact support.
        </p>
      )}

      {showInvite && (
        <div className="rounded-md border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Roles</span>
            <RoleAssignControl
              roles={roles}
              selectedIds={inviteRoleIds}
              onChange={setInviteRoleIds}
              disabledReason={inviteRoleReason}
              label="Edit roles for the new user"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Temporary Password</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newUser.tempPassword}
                onChange={(e) => setNewUser({ ...newUser, tempPassword: e.target.value })}
                className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
                placeholder="Tell this to the new user directly"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewUser({ ...newUser, tempPassword: generateTempPassword() })}
              >
                Generate
              </Button>
            </div>
            {/* Same rules the users API enforces on the server */}
            <ul className="mt-2 space-y-1 text-xs" aria-live="polite">
              <Requirement met={tempPasswordLongEnough}>At least {MIN_PASSWORD_LENGTH} characters</Requirement>
              <Requirement met={tempPasswordShortEnough}>No more than {MAX_PASSWORD_BYTES} characters</Requirement>
            </ul>
          </div>
          <Button onClick={handleInvite} disabled={!tempPasswordValid}>Create User</Button>
        </div>
      )}

      {/* Fixed table layout: column widths come from the colgroup, never from
          cell content, so expanding a row's roles only makes that row taller.
          Roles, Status, and Actions have set widths; Name and Email split the
          rest and truncate with a tooltip. Below the min width the table
          scrolls sideways instead of squeezing columns. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52.5rem] table-fixed text-sm border-collapse">
          <colgroup>
            <col />
            <col />
            <col className="w-84" />
            <col className="w-28" />
            <col className="w-14" />
          </colgroup>
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Roles</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const lockedReason = userLockedReason(user)
              return (
                <tr key={user.id} className="border-b align-top">
                  <td className="truncate py-2 pr-3" title={user.name}>{user.name}</td>
                  <td className="truncate py-2 pr-3" title={user.email}>{user.email}</td>
                  <td className="py-2 pr-3">
                    <RoleAssignControl
                      collapsible
                      roles={roles}
                      selectedIds={user.roles.map((r) => r.id)}
                      onChange={(nextIds) => setUserRoles(user, nextIds)}
                      disabledReason={(role) => existingUserRoleReason(role, user)}
                      lockedReason={lockedReason}
                      busy={savingUserId === user.id}
                      label={`Edit roles for ${user.name}`}
                      showEditButton={false}
                      teamRoles={user.teamRoles}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    {/* Read only. Activating, deactivating, and unlocking
                        all live in the row's Actions menu. */}
                    <div className="flex flex-col items-start gap-1">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          user.active
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </span>
                      {isGlobalAdmin && user.loginLockedUntil && (
                        <span
                          className="rounded-full bg-danger/10 px-2 py-1 text-xs font-medium text-danger"
                          title={`Too many wrong passwords. Locked until ${new Date(user.loginLockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                        >
                          Locked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    <UserActionsMenu
                      user={user}
                      manageReason={lockedReason ? "This user is at or above your rank" : null}
                      isSelf={user.id === myId}
                      canUnlock={isGlobalAdmin && !!user.loginLockedUntil}
                      onSetActive={(active) => setUserActive(user, active)}
                      onUnlock={() => unlockUser(user)}
                      roles={roles}
                      onRolesChange={(nextIds) => setUserRoles(user, nextIds)}
                      roleDisabledReason={(role) => existingUserRoleReason(role, user)}
                      rolesBusy={savingUserId === user.id}
                      onEditTeams={canManageTeams ? () => setTeamsUser(user) : undefined}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {teamsUser && (
        <UserTeamsDialog
          user={teamsUser}
          teams={teams}
          myUserId={myId}
          onClose={() => setTeamsUser(null)}
          onSaved={() => {
            setTeamsUser(null)
            loadUsers()
          }}
        />
      )}
    </div>
  )
}

// Adds or removes a user's teams (PATCH /api/users/[id] teamIds), with the
// Teams screen's rules: joining a team gives its default roles, so a team
// giving a role you couldn't give (memberGrantRefusal) can't be added, and
// a user ranked at or above you can't be added to or removed from any team
// (teamChangeRefusal), though you may always take yourself out of one.
function UserTeamsDialog({
  user,
  teams,
  myUserId,
  onClose,
  onSaved,
}: {
  user: User
  teams: TeamSummary[]
  myUserId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const savedIds = (user.teams ?? []).map((t) => t.id)
  const [teamIds, setTeamIds] = useState<string[]>(savedIds)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamIds }),
    })
    setSaving(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error("Couldn't update teams", err.error)
      return
    }
    toast.success("Teams updated", user.name)
    onSaved()
  }

  return (
    <Modal maxWidth="md" onClose={saving ? undefined : onClose}>
      <h2 className="text-lg font-bold text-foreground">Teams for {user.name}</h2>
      <SearchableChecklist
        label="Teams"
        description="The user holds each team's default roles while they are in it."
        options={teams.map((team) => ({
          value: team.id,
          label: team.name,
          searchText: team.name,
          // Unticking a saved team is a removal, ticking another an addition
          disabledReason:
            savedIds.includes(team.id) && teamIds.includes(team.id)
              ? memberChangeBlockReason(user, myUserId, "remove")
              : !savedIds.includes(team.id) && !teamIds.includes(team.id)
                ? (team.memberGrantRefusal ?? memberChangeBlockReason(user, myUserId, "add"))
                : null,
        }))}
        selected={teamIds}
        onChange={setTeamIds}
        disabled={saving}
        emptyText="No teams yet. Add them in Settings, Teams."
        searchLabel="Search teams"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save teams"}
        </Button>
      </div>
    </Modal>
  )
}

// One row's Actions menu: Edit Roles, Deactivate or Activate, and (Global
// Admins, locked users only) Unlock. Built on the same dropdown menu as the
// top bar's user menu, which handles the keyboard, Escape, focus return,
// and portals the menu out of the table's scroll area. Items the acting
// user can't use stay visible, disabled, with the reason underneath.
function UserActionsMenu({
  user,
  manageReason,
  isSelf,
  canUnlock,
  onSetActive,
  onUnlock,
  roles,
  onRolesChange,
  roleDisabledReason,
  rolesBusy,
  onEditTeams,
}: {
  user: User
  // Set when the user is at or above your rank, so you can't manage them
  manageReason: string | null
  isSelf: boolean
  canUnlock: boolean
  onSetActive: (active: boolean) => void
  onUnlock: () => void
  roles: AssignableRole[]
  onRolesChange: (nextIds: string[]) => void
  roleDisabledReason: (role: AssignableRole) => string | null
  rolesBusy: boolean
  // Only with the Teams permission
  onEditTeams?: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [checklistAnchor, setChecklistAnchor] = useState<MenuAnchor | null>(null)
  // The chosen item's action runs once the menu has finished closing and
  // focus is back on the trigger, so a dialog or checklist it opens takes
  // focus from (and later returns it to) the trigger, not the closing menu
  const pendingAction = useRef<(() => void) | null>(null)

  const activeReason = user.active && isSelf ? "You cannot deactivate your own account." : manageReason

  function openChecklist() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setChecklistAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
    }
    setChecklistOpen(true)
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setChecklistOpen(false)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${user.name}`}
            className="size-10 sm:size-8"
          >
            <Menu aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(e) => {
            const action = pendingAction.current
            if (!action) return
            pendingAction.current = null
            e.preventDefault()
            triggerRef.current?.focus()
            action()
          }}
        >
          <UserActionItem
            label="Edit Roles"
            reason={manageReason}
            onSelect={() => (pendingAction.current = openChecklist)}
          />
          {onEditTeams && <UserActionItem label="Edit Teams" reason={null} onSelect={() => (pendingAction.current = onEditTeams)} />}
          <UserActionItem
            label={user.active ? "Deactivate User" : "Activate User"}
            reason={activeReason}
            destructive={user.active}
            onSelect={() => (pendingAction.current = () => onSetActive(!user.active))}
          />
          {canUnlock && <UserActionItem label="Unlock User" reason={null} onSelect={onUnlock} />}
        </DropdownMenuContent>
      </DropdownMenu>

      <RoleChecklist
        open={checklistOpen}
        anchor={checklistAnchor}
        triggerRef={triggerRef}
        onClose={() => setChecklistOpen(false)}
        roles={roles}
        selectedIds={user.roles.map((r) => r.id)}
        onChange={onRolesChange}
        disabledReason={roleDisabledReason}
        busy={rolesBusy}
        label={`Edit roles for ${user.name}`}
        autoFocus
        teamRoles={user.teamRoles}
      />
    </>
  )
}

function UserActionItem({
  label,
  reason,
  destructive = false,
  onSelect,
}: {
  label: string
  reason: string | null
  destructive?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      disabled={!!reason}
      variant={destructive ? "destructive" : "default"}
      onSelect={onSelect}
      className="min-h-11 py-2 sm:min-h-9"
    >
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {reason && <span className="text-caption text-muted-foreground">{reason}</span>}
      </span>
    </DropdownMenuItem>
  )
}
