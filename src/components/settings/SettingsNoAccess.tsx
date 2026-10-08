import { Lock } from "lucide-react"

// Shown in place of a settings panel's form when the server refuses to load
// it (403), so the user sees why instead of an empty or broken form.
export function SettingsNoAccess() {
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-md border p-6 text-center">
      <Lock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
      <p className="text-sm font-medium">You do not have access to this section</p>
      <p className="text-sm text-zinc-500">Ask an administrator if you need to change these settings.</p>
    </div>
  )
}
