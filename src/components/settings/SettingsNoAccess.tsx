import { NoAccess } from "@/components/NoAccess"

// Shown in place of a settings panel's form when the server refuses to load
// it (403), so the user sees why instead of an empty or broken form.
export function SettingsNoAccess() {
  return (
    <NoAccess
      title="You do not have access to this section"
      description="Ask an administrator if you need to change these settings."
    />
  )
}
