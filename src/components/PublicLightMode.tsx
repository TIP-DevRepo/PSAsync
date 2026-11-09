"use client"

import { useLayoutEffect } from "react"
import { usePathname } from "next/navigation"
import { isStaffThemedPath } from "@/lib/theme"

// Outside the staff app (the customer portal, sign in, and every other
// public page) the page is always light. A full page load already is (the
// root layout writes only the light default and no dark class); this
// covers a client side navigation out of the staff app, which would
// otherwise keep the dark class the staff theme set.
export function PublicLightMode() {
  const pathname = usePathname()
  useLayoutEffect(() => {
    if (isStaffThemedPath(pathname)) return
    const root = document.documentElement
    root.classList.remove("dark")
    root.classList.add("light")
    root.style.colorScheme = "light"
    document.getElementById("ps-theme-preview")?.remove()
  }, [pathname])
  return null
}
