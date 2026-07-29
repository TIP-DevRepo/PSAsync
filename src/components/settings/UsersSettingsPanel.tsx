"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface RoleOption {
  id: string
  name: string
  rank: number
}

interface User {
  id: string
  name: string
  email: string
  active: boolean
  role: RoleOption | null
}

export function UsersSettingsPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [newUser, setNewUser] = useState({ name: "", email: "", roleId: "", tempPassword: "" })

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
      .then((data: RoleOption[]) => {
        setRoles(data)
        if (data.length > 0) {
          setNewUser((prev) => ({ ...prev, roleId: prev.roleId || data[0].id }))
        }
      })
  }, [])

  async function handleInvite() {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    })

    if (!res.ok) {
      const err = await res.json()
      toast.error("Couldn't invite user", err.error)
      return
    }

    toast.success(`Invited ${newUser.name || newUser.email}`)
    setNewUser({ name: "", email: "", roleId: roles[0]?.id ?? "", tempPassword: "" })
    setShowInvite(false)
    loadUsers()
  }

  async function updateUser(id: string, changes: { roleId?: string; active?: boolean }) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    })
    if (res.ok) {
      if (changes.active !== undefined) {
        toast.success(changes.active ? "User activated" : "User deactivated")
      } else if (changes.roleId !== undefined) {
        toast.success("Role updated")
      }
    } else {
      toast.error("Couldn't update user")
    }
    loadUsers()
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Manage who has access and what role they hold.</p>
        <Button onClick={() => setShowInvite(!showInvite)} disabled={roles.length === 0}>
          {showInvite ? "Cancel" : "Invite User"}
        </Button>
      </div>

      {roles.length === 0 && (
        <p className="text-xs text-amber-600">
          No roles found for your company yet — something's wrong with your role setup. Contact support.
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
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={newUser.roleId}
              onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Temporary Password</label>
            <input
              type="text"
              value={newUser.tempPassword}
              onChange={(e) => setNewUser({ ...newUser, tempPassword: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Tell this to the new user directly"
            />
          </div>
          <Button onClick={handleInvite}>Create User</Button>
        </div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Name</th>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b">
              <td className="py-2">{user.name}</td>
              <td className="py-2">{user.email}</td>
              <td className="py-2">
                <select
                  value={user.role?.id ?? ""}
                  onChange={(e) => updateUser(user.id, { roleId: e.target.value })}
                  className="rounded-md border px-2 py-1 text-sm"
                >
                  {!user.role && <option value="">Unassigned</option>}
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </td>
              <td className="py-2">
                <button
                  onClick={() => updateUser(user.id, { active: !user.active })}
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    user.active
                      ? "bg-green-100 text-green-700"
                      : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {user.active ? "Active" : "Inactive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}