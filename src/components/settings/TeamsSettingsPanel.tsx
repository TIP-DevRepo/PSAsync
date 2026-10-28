"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { DndContext, closestCenter, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"
import { RolePill } from "@/components/roles/RolePill"
import { SearchableChecklist } from "@/components/teams/SearchableChecklist"
import { useAccess } from "@/components/AccessProvider"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import { announcementsFor, DragHandle, errorOf, SectionError, send, useReorderSensors } from "@/components/settings/OpportunitySettingsPanel"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { sortUsersByName } from "@/lib/user-picker"
import { cn } from "@/lib/utils"
import {
  actorRank,
  addMemberBlockReason,
  defaultRoleBlockReason,
  TEAM_DESCRIPTION_MAX,
  TEAM_NAME_MAX,
  type TeamRole,
  type TeamSummary,
} from "@/lib/team-rules"

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-sm font-medium text-foreground"

interface UserOption {
  id: string
  name: string
  active: boolean
}

// Settings > Teams (settingsSections.teams): the company's teams in order,
// dragged to reorder, each with its member count and default roles. Teams
// are created and edited in a dialog; General is marked and can't be
// deleted. A refused change (a team in use, a role out of reach) shows the
// API's own message.
export function TeamsSettingsPanel() {
  const { access, can } = useAccess()
  const [teams, setTeams] = useState<TeamSummary[] | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const [roles, setRoles] = useState<TeamRole[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // null closed, "new", or the team being edited
  const [editing, setEditing] = useState<TeamSummary | "new" | null>(null)
  const sensors = useReorderSensors()
  const myRank = actorRank(access)
  const allowed = can("settingsSections.teams")

  useEffect(() => {
    if (!allowed) return
    const json = (res: Response) => (res.ok ? res.json() : Promise.reject(new Error("refused")))
    fetch("/api/teams")
      .then(json)
      .then((data: TeamSummary[]) => setTeams(data))
      .catch(() => setLoadFailed(true))
    fetch("/api/users")
      .then(json)
      .then((data: UserOption[]) => setUsers(sortUsersByName(data)))
      .catch(() => setLoadFailed(true))
    fetch("/api/roles")
      .then(json)
      // Everyone is held by every user, so it is never a team's default role
      .then((data: (TeamRole & { isEveryone?: boolean })[]) => setRoles(data.filter((r) => !r.isEveryone)))
      .catch(() => setLoadFailed(true))
  }, [allowed])

  if (!allowed) return <SettingsNoAccess />
  if (loadFailed) return <p className="text-sm text-danger">Couldn&apos;t load the teams. Refresh to try again.</p>
  if (!teams) return <p className="text-sm text-muted-foreground">Loading...</p>

  const teamName = (id: UniqueIdentifier) => teams.find((t) => t.id === String(id))?.name ?? "team"

  async function reload() {
    const res = await fetch("/api/teams")
    if (res.ok) setTeams(await res.json())
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!teams) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = teams.findIndex((t) => t.id === active.id)
    const to = teams.findIndex((t) => t.id === over.id)
    if (from < 0 || to < 0) return
    const previous = teams
    const next = arrayMove(teams, from, to)
    setTeams(next)
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/teams/reorder", "POST", { teamIds: next.map((t) => t.id) })
    setBusy(false)
    if (!ok) {
      setTeams(previous)
      setError(errorOf(data, "Couldn't save the new team order."))
      return
    }
    setTeams(data as TeamSummary[])
    toast.success("Team order saved")
  }

  async function handleDelete(team: TeamSummary) {
    const confirmed = await confirmDialog({
      title: `Delete the ${team.name} team?`,
      description: "Its members lose the roles this team gives them, unless they hold them some other way. This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/teams/${team.id}`, "DELETE")
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't delete the team."))
      return
    }
    toast.success(`Team ${team.name} deleted`)
    reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Teams group users for opportunities (and tickets later). Members hold the team&apos;s default roles while they are in it. Drag to change the order the sidebar and pickers show.
        </p>
        <Button onClick={() => setEditing("new")} disabled={busy} className="gap-1">
          <Plus size={14} aria-hidden="true" />
          New team
        </Button>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      {/* DndContext renders hidden elements where it sits, so it wraps the list, never inside it */}
      <DndContext id="teams-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor(teamName) }}>
        <SortableContext items={teams.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {teams.map((team) => (
              <TeamRow key={team.id} team={team} busy={busy} onEdit={() => setEditing(team)} onDelete={() => handleDelete(team)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {editing && (
        <TeamDialog
          team={editing === "new" ? null : editing}
          users={users}
          roles={roles}
          myRank={myRank}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function TeamRow({ team, busy, onEdit, onDelete }: { team: TeamSummary; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: team.id, disabled: busy })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-start gap-2 rounded-md border border-border bg-card py-2 pl-1 pr-3 text-sm", isDragging && "relative z-10 scale-[1.02] shadow-popover")}
    >
      <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${team.name}`} disabled={busy} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium text-foreground">{team.name}</span>
          {team.isDefault && (
            <span className="rounded-full bg-brand-primary-500/10 px-2 py-0.5 text-caption font-medium text-brand-primary-500" title="New opportunities go here unless another team is chosen">
              Default
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
        {team.description && <p className="break-words text-xs text-muted-foreground">{team.description}</p>}
        <div className="flex flex-wrap items-center gap-1">
          {team.defaultRoles.length === 0 ? (
            <span className="text-xs text-muted-foreground">No default roles</span>
          ) : (
            team.defaultRoles.map((role) => <RolePill key={role.id} role={role} />)
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-1">
        <button type="button" onClick={onEdit} disabled={busy} className="text-xs font-medium text-primary hover:underline disabled:opacity-60">
          Edit
        </button>
        {!team.isDefault && (
          <button type="button" onClick={onDelete} disabled={busy} className="text-xs font-medium text-muted-foreground hover:text-danger disabled:opacity-60">
            Delete
          </button>
        )}
      </div>
    </li>
  )
}

// Create or edit one team: name, description, members, and default roles.
// Roles the editor couldn't grant directly are listed disabled with the
// reason, and so are new members of a team that gives such a role. Saving
// an existing team sends only what changed, default roles before members
// (so removing a role out of reach first lets members be added).
function TeamDialog({
  team,
  users,
  roles,
  myRank,
  onClose,
  onSaved,
}: {
  team: TeamSummary | null
  users: UserOption[]
  roles: TeamRole[]
  myRank: number
  onClose: () => void
  onSaved: () => void
}) {
  const savedMemberIds = (team?.members ?? []).map((m) => m.id)
  const savedRoleIds = (team?.defaultRoles ?? []).map((r) => r.id)
  const [name, setName] = useState(team?.name ?? "")
  const [description, setDescription] = useState(team?.description ?? "")
  const [memberIds, setMemberIds] = useState<string[]>(savedMemberIds)
  const [roleIds, setRoleIds] = useState<string[]>(savedRoleIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Active users, plus members deactivated since they joined (so they can be removed)
  const memberChoices = sortUsersByName([
    ...users.filter((u) => u.active || savedMemberIds.includes(u.id)),
    ...(team?.members ?? []).filter((m) => !users.some((u) => u.id === m.id)),
  ])
  const chosenRoles = roles.filter((r) => roleIds.includes(r.id))
  const addBlocked = addMemberBlockReason(chosenRoles, myRank)

  async function handleSave() {
    if (!name.trim()) {
      setError("Team name is required")
      return
    }
    setSaving(true)
    setError(null)
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))
    const steps: { url: string; method: string; body: unknown }[] = team
      ? [
          ...(name.trim() !== team.name || (description.trim() || null) !== team.description
            ? [{ url: `/api/teams/${team.id}`, method: "PATCH", body: { name: name.trim(), description: description.trim() || null } }]
            : []),
          ...(sameSet(roleIds, savedRoleIds) ? [] : [{ url: `/api/teams/${team.id}/default-roles`, method: "PUT", body: { roleIds } }]),
          ...(sameSet(memberIds, savedMemberIds) ? [] : [{ url: `/api/teams/${team.id}/members`, method: "PUT", body: { userIds: memberIds } }]),
        ]
      : [{ url: "/api/teams", method: "POST", body: { name: name.trim(), description: description.trim() || null, memberIds, defaultRoleIds: roleIds } }]

    for (const step of steps) {
      const { ok, data } = await send(step.url, step.method, step.body)
      if (!ok) {
        setSaving(false)
        setError(errorOf(data, "Couldn't save the team."))
        return
      }
    }
    toast.success(team ? `Team ${name.trim()} saved` : `Team ${name.trim()} created`)
    onSaved()
  }

  return (
    <Modal maxWidth="xl" scrollable onClose={saving ? undefined : onClose}>
      <h2 className="text-lg font-bold text-foreground">{team ? `Edit ${team.name}` : "New team"}</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
      >
        <SectionError message={error} onDismiss={() => setError(null)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="team-name" className={LABEL}>
              Name <span className="text-danger">*</span>
            </label>
            <input id="team-name" value={name} maxLength={TEAM_NAME_MAX} onChange={(e) => setName(e.target.value)} className={FIELD} autoFocus />
            {team?.isDefault && <p className="mt-1 text-xs text-muted-foreground">The default team. It can be renamed but not deleted.</p>}
          </div>
          <div>
            <label htmlFor="team-description" className={LABEL}>
              Description
            </label>
            <textarea
              id="team-description"
              value={description}
              maxLength={TEAM_DESCRIPTION_MAX}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              className={FIELD}
            />
          </div>
          <SearchableChecklist
            label="Members"
            description={addBlocked ? `${addBlocked}, so you can't add members. You can still remove them.` : undefined}
            options={memberChoices.map((u) => ({
              value: u.id,
              label: u.active === false ? `${u.name} (inactive)` : u.name,
              searchText: u.name,
              disabledReason: !savedMemberIds.includes(u.id) && !memberIds.includes(u.id) ? addBlocked : null,
            }))}
            selected={memberIds}
            onChange={setMemberIds}
            disabled={saving}
            emptyText="No users yet."
            searchLabel="Search users"
          />
          <SearchableChecklist
            label="Default roles"
            description="Every member holds these roles while they are in the team."
            options={roles.map((role) => ({
              value: role.id,
              label: <RolePill role={role} />,
              searchText: role.name,
              disabledReason: defaultRoleBlockReason(role, myRank, savedRoleIds.includes(role.id)),
            }))}
            selected={roleIds}
            onChange={setRoleIds}
            disabled={saving}
            emptyText="No roles yet."
            searchLabel="Search roles"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : team ? "Save team" : "Create team"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
