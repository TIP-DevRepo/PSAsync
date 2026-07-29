import { toast as heroToast } from "@heroui/react"

// Dismiss timing per the design rules doc: routine confirmations clear
// quickly, warnings linger longer, and anything the user actually needs
// to act on (errors) stays put until they close it themselves.
const TIMEOUT = {
  routine: 4000,
  warning: 7000,
  critical: 0, // 0 = persistent, only the close button dismisses it
} as const

export const toast = {
  success(title: string, description?: string) {
    return heroToast(title, { variant: "success", description, timeout: TIMEOUT.routine })
  },
  info(title: string, description?: string) {
    return heroToast(title, { variant: "accent", description, timeout: TIMEOUT.routine })
  },
  warning(title: string, description?: string) {
    return heroToast(title, { variant: "warning", description, timeout: TIMEOUT.warning })
  },
  error(title: string, description?: string) {
    return heroToast(title, { variant: "danger", description, timeout: TIMEOUT.critical })
  },
}