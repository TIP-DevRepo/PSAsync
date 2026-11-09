"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { LogOut, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { initialsOf } from "@/components/ui/blocks"
import { cn } from "@/lib/utils"

// The signed in user's button at the bottom of the sidebar. It opens a
// small menu (Radix: arrow keys move between items, Enter or Space picks
// one, Escape closes it and returns focus to the button) with My settings
// and Log out. Log out is also on the My settings page itself.
export function UserMenu({ userName }: { userName: string }) {
  const pathname = usePathname()
  const onSettings = pathname.startsWith("/dashboard/account")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${userName}, account menu`}
          className={cn(
            "mt-3 flex w-full items-center gap-2.5 rounded-[10px] border-t border-sb-border p-2.5 text-left transition-colors hover:bg-sb-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sb-hover",
            onSettings && "bg-sb-hover"
          )}
        >
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-acc text-[13px] font-semibold text-acc-on">
            {initialsOf(userName)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold">{userName}</span>
            <span className="text-xs text-sb-muted">Account</span>
          </span>
          <Settings size={16} aria-hidden="true" className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
        <DropdownMenuLabel className="truncate text-xs font-medium text-muted-foreground">{userName}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/account">
            <Settings size={16} aria-hidden="true" />
            My settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/login" })}>
          <LogOut size={16} aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
