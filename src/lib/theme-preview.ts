// Browser only: shows a theme on the whole page at once, while the
// Appearance settings save it. A style element at the end of the body, after
// the server's ones (the root layout's light default and the staff app's
// #ps-theme), holds the new variables, and
// the html element's light or dark class follows the mode. Once the saved
// theme comes back from the server the two match; preview(null) removes it.

import { themeCss, type ResolvedTheme } from "@/lib/theme"

const PREVIEW_ID = "ps-theme-preview"

export function previewTheme(theme: ResolvedTheme | null): void {
  if (typeof document === "undefined") return
  let el = document.getElementById(PREVIEW_ID) as HTMLStyleElement | null
  if (!theme) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement("style")
    el.id = PREVIEW_ID
    document.body.appendChild(el)
  }
  el.textContent = themeCss(theme)
  const dark = theme.mode === "DARK" || (theme.mode === "SYSTEM" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.classList.toggle("light", !dark)
  root.style.colorScheme = dark ? "dark" : "light"
}
