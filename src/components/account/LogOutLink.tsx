"use client"

import { signOut } from "next-auth/react"

// A plain text Log out link, for screens outside the dashboard layout
// (which has the top bar's user menu instead)
export function LogOutLink() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Log out
    </button>
  )
}
