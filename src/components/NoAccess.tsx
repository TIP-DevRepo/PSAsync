import { Lock } from "lucide-react"

// Shown in place of a page or panel the user may not use, so they see why
// instead of an empty screen full of failed requests
export function NoAccess({
  title = "You do not have access to this page",
  description = "Ask an administrator if you need access.",
}: {
  title?: string
  description?: string
}) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-md border p-6 text-center">
      <Lock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-zinc-500">{description}</p>
    </div>
  )
}
