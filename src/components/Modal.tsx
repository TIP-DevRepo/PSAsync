"use client"

import type { ReactNode } from "react"
import { Modal as HeroModal } from "@heroui/react"

interface ModalProps {
  children: ReactNode
  maxWidth?: "sm" | "md" | "lg"
  /** Adds max-h-[90vh] overflow-y-auto for modals with long, scrollable content */
  scrollable?: boolean
  /**
   * Optional. When provided, the modal becomes dismissible — clicking the
   * backdrop or pressing Escape calls this. Omit to keep the original
   * behavior every existing modal already relies on: no backdrop/Escape
   * dismiss, closing only via whatever explicit Cancel/Close button the
   * modal's own content provides.
   */
  onClose?: () => void
}

const MAX_WIDTH_CLASSES: Record<NonNullable<ModalProps["maxWidth"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
}

// Shared modal backdrop + centered box, built on HeroUI's real compound
// Modal primitive (Root > Backdrop > Container > Dialog) — which gives
// real focus-trapping, focus return to whatever triggered it on close,
// and an inert background, for free. Since this component is only ever
// mounted while a parent's condition is true, "mounted" is treated as
// permanently isOpen — there's no exit animation, matching the instant
// unmount behavior every call site already has today.
export function Modal({ children, maxWidth = "md", scrollable = false, onClose }: ModalProps) {
  return (
    <HeroModal.Root
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <HeroModal.Backdrop isDismissable={!!onClose} isKeyboardDismissDisabled={!onClose}>
        <HeroModal.Container placement="center">
          <HeroModal.Dialog
            className={`bg-popover text-popover-foreground border border-border rounded-lg shadow-popover p-6 w-full ${MAX_WIDTH_CLASSES[maxWidth]} space-y-4 ${
              scrollable ? "max-h-[90vh] overflow-y-auto" : ""
            }`}
          >
            {children}
          </HeroModal.Dialog>
        </HeroModal.Container>
      </HeroModal.Backdrop>
    </HeroModal.Root>
  )
}