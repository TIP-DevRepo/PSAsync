"use client"

import { Toast, type ToastContentValue } from "@heroui/react"

type ToastVariant = NonNullable<ToastContentValue["variant"]>

// Tinted pill for the icon plus a matching hairline border, so the type
// never reads from color alone. Full class strings so Tailwind sees them.
const VARIANT_STYLES: Record<ToastVariant, { border: string; pill: string }> = {
  success: { border: "border-success/40", pill: "bg-success/10 text-success" },
  danger: { border: "border-danger/40", pill: "bg-danger/10 text-danger" },
  warning: { border: "border-warning/40", pill: "bg-warning/10 text-warning" },
  accent: { border: "border-info/40", pill: "bg-info/10 text-info" },
  default: { border: "border-border", pill: "bg-muted text-foreground" },
}

// Mounted once in the root layout. Toasts are queued through the helpers
// in @/lib/toast and render top center, newest on top, with HeroUI's
// stacking. z-60 keeps them above every modal, dialog, and popover (all
// z-50), whichever was opened first.
export function AppToastProvider() {
  return (
    <Toast.Provider placement="top" maxVisibleToasts={3} className="z-60">
      {({ toast }) => {
        const { title, description } = toast.content
        const variant = toast.content.variant ?? "default"
        const styles = VARIANT_STYLES[variant]
        // Errors interrupt the screen reader; everything else waits its turn
        const isError = variant === "danger"

        return (
          <Toast
            toast={toast}
            variant={variant}
            className={`app-toast gap-3 rounded-xl border bg-popover text-popover-foreground shadow-popover ${styles.border}`}
          >
            <Toast.Indicator variant={variant} className={`size-7 rounded-full ${styles.pill}`} />
            <Toast.Content
              role={isError ? "alert" : "status"}
              aria-live={isError ? "assertive" : "polite"}
              className="min-w-0 break-words"
            >
              {title && <Toast.Title className="text-foreground">{title}</Toast.Title>}
              {description && (
                <Toast.Description className="text-muted-foreground">{description}</Toast.Description>
              )}
            </Toast.Content>
            <Toast.CloseButton className="static size-7 shrink-0 border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground [&_[data-slot=close-button-icon]]:size-4" />
          </Toast>
        )
      }}
    </Toast.Provider>
  )
}
