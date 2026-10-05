"use client"

import { useState } from "react"
import { Check, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules"

const EMPTY_FORM = { currentPassword: "", newPassword: "", confirmPassword: "" }

type FieldKey = keyof typeof EMPTY_FORM

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  onChange,
}: {
  id: FieldKey
  label: string
  value: string
  autoComplete: "current-password" | "new-password"
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1 text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2", met ? "text-success" : "text-muted-foreground")}>
      <Check className={cn("h-3.5 w-3.5", !met && "opacity-30")} />
      {children}
    </li>
  )
}

export function ChangePasswordCard() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const longEnough = form.newPassword.length >= MIN_PASSWORD_LENGTH
  const matches = form.newPassword.length > 0 && form.newPassword === form.confirmPassword
  const different = form.newPassword.length > 0 && form.newPassword !== form.currentPassword
  const canSubmit = form.currentPassword.length > 0 && longEnough && matches && different && !saving

  function setField(key: FieldKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast.success("Password updated", "Use your new password the next time you sign in.")
        setForm(EMPTY_FORM)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error("Couldn't change password", err.error)
      }
    } catch {
      toast.error("Couldn't change password", "Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-card p-6 space-y-4">
      <div>
        <h2 className="text-heading font-semibold text-foreground">Change Password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your current password, then choose a new one.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField
          id="currentPassword"
          label="Current Password"
          value={form.currentPassword}
          autoComplete="current-password"
          onChange={(v) => setField("currentPassword", v)}
        />
        <PasswordField
          id="newPassword"
          label="New Password"
          value={form.newPassword}
          autoComplete="new-password"
          onChange={(v) => setField("newPassword", v)}
        />
        <PasswordField
          id="confirmPassword"
          label="Confirm New Password"
          value={form.confirmPassword}
          autoComplete="new-password"
          onChange={(v) => setField("confirmPassword", v)}
        />

        <ul className="space-y-1 text-xs" aria-live="polite">
          <Requirement met={longEnough}>At least {MIN_PASSWORD_LENGTH} characters</Requirement>
          <Requirement met={different}>Different from your current password</Requirement>
          <Requirement met={matches}>Confirmation matches</Requirement>
        </ul>

        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit}>
            {saving ? "Updating..." : "Update Password"}
          </Button>
        </div>
      </form>
    </section>
  )
}
