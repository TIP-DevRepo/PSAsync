import { toast as heroToast } from "@heroui/react"

// Dismiss timing: routine confirmations clear on their own, while
// anything the user actually needs to act on (warnings and errors) stays
// put until they close it themselves.
const TIMEOUT = {
  routine: 4000,
  persistent: 0, // 0 = persistent, only the close button dismisses it
} as const

export const toast = {
  success(title: string, description?: string) {
    return heroToast(title, { variant: "success", description, timeout: TIMEOUT.routine })
  },
  info(title: string, description?: string) {
    return heroToast(title, { variant: "accent", description, timeout: TIMEOUT.routine })
  },
  warning(title: string, description?: string) {
    return heroToast(title, { variant: "warning", description, timeout: TIMEOUT.persistent })
  },
  error(title: string, description?: string) {
    return heroToast(title, { variant: "danger", description, timeout: TIMEOUT.persistent })
  },
}
