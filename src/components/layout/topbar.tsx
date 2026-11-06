"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Sidebar, type SidebarProps } from "./sidebar"
import { NotificationBell } from "./notification-bell"
import { TopbarSlotTarget } from "./TopbarSlots"

// The top bar, as the design draws it: the page's breadcrumb (filled by the
// shared Breadcrumbs), the page's primary action (TopbarAction), and the
// notifications bell. At phone width the sidebar folds into a menu button
// here. The signed in user's own settings and Log out are on My settings,
// opened from the sidebar's user button.
export function Topbar(sidebar: SidebarProps) {
  const pathname = usePathname()
  // The phone menu closes on every navigation
  const [menu, setMenu] = useState<{ open: boolean; path: string }>({ open: false, path: pathname })
  const open = menu.open && menu.path === pathname

  return (
    <header className="flex min-h-[66px] flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3.5 sm:px-7">
      <Sheet open={open} onOpenChange={(next) => setMenu({ open: next, path: pathname })}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-control border border-border bg-card text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="max-w-[85vw] border-r-0 bg-sb-bg p-0 text-sb-text data-[side=left]:w-[264px]">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Sidebar {...sidebar} />
        </SheetContent>
      </Sheet>

      <TopbarSlotTarget slot="crumbs" className="min-w-0 flex-1" />
      <TopbarSlotTarget slot="action" className="flex items-center gap-2 empty:hidden" />
      <NotificationBell />
    </header>
  )
}
