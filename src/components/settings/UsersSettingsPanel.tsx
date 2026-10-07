"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { RoleAssignControl, type AssignableRole } from "@/components/roles/RoleAssignControl"

interface RoleOption extends AssignableRole {
  isEveryone?: boolean
}

// Excludes }{[]|\/><;:'"~`+=,.^ since those tend to cause trouble when a
// temp password gets copy-pasted into a URL, CSV, or shell command.
const TEMP_PASSWORD_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*()-_?"

function generateTempPassword(length = 12): string {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (v) => TEMP_PASSWORD_CHARS[v % TEMP_PASSWORD_CHARS.length]).join("")
}

interface User {
  id: string
  name: string
  email: string
  active: boolean
  // Every role the user holds, highest rank first (never Everyone)
  roles: AssignableRole[]
  // Only sent to Global Admins, and only set while the login is locked
  loginLockedUntil?: string | null
}

export function UsersSettingsPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  // Your own highest rank, the same number the server's hierarchy rules
  // use (Global Admin is effectively infinite). Null until it loads, which
  // keeps every role and user locked rather than briefly looking editable.
  const [myRank, setMyRank] = useState<number | null>(null)
  // Only a Global Admin sees login locks and can unlock them. The server
  // enforces this too, this only decides whether to show the button.
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false)
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
        setUsers(json)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadUsers()
    fetch("/api/roles")
      .then((res) => res.json())
      // Everyone is held by every user implicitly, so it is never assignable
      .then((data: RoleOption[]) => setRoles(data.filter((r) => !r.isEveryone)))
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((session) => {
        const access = session?.user?.access
        setMyRank(access?.isGlobalAdmin ? Number.MAX_SAFE_INTEGER : access?.rank ?? 0)
        setIsGlobalAdmin(!!access?.isGlobalAdmin)
      })
  }, [])

  // Same rules the users API enforces. Changing an existing user's roles
  // needs the user AND every role involved strictly below your own rank.
  // Inviting allows roles at or below your rank.
  function existingUserRoleReason(role: AssignableRole) {
    if (myRank === null || role.rank >= myRank) return "At or above your rank"
    return null
  }
  function inviteRoleReason(role: AssignableRole) {
    if (myRank === null || role.rank > myRank) return "Above your rank"
    return null
  }
  function userLockedReason(user: User) {
    const userRank = user.roles.length > 0 ? Math.max(...user.roles.map((r) => r.rank)) : 0
    if (myRank === null || userRank >= myRank) return "This user is at or above your rank, so you can't change their roles"
    return null
  }

  async function handleInvite() {
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

  async function setUserActive(user: User, active: boolean) {
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
          </div>
          <Button onClick={handleInvite}>Create User</Button>
        </div>
      )}

      {/* Fixed table layout: column widths come from the colgroup, never from
          cell content, so expanding a row's roles only makes that row taller.
          Roles and Status have set widths; Name and Email split the rest and
          truncate with a tooltip. Below the min width the table scrolls
          sideways instead of squeezing columns. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[49rem] table-fixed text-sm border-collapse">
          <colgroup>
            <col />
            <col />
            <col className="w-84" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Roles</th>
              <th className="py-2">Status</th>
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
                      disabledReason={existingUserRoleReason}
                      lockedReason={lockedReason}
                      busy={savingUserId === user.id}
                      label={`Edit roles for ${user.name}`}
                    />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col items-start gap-1">
                      <button
                        onClick={() => setUserActive(user, !user.active)}
                        disabled={!!lockedReason}
                        title={lockedReason ? "This user is at or above your rank" : undefined}
                        className={`rounded-full px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                          user.active
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </button>
                      {isGlobalAdmin && user.loginLockedUntil && (
                        <>
                          <span
                            className="rounded-full bg-danger/10 px-2 py-1 text-xs font-medium text-danger"
                            title={`Too many wrong passwords. Locked until ${new Date(user.loginLockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                          >
                            Locked
                          </span>
                          <Button size="xs" variant="outline" onClick={() => unlockUser(user)}>
                            Unlock
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
