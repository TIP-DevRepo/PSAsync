import type { ReactNode } from "react"
import { ThemeProvider } from "next-themes"
import { forcedThemeFor, themeCss, type ResolvedTheme } from "@/lib/theme"

// The signed in user's theme, for the staff app only (the dashboard layout
// renders this). The root layout writes only the light PSAsync default, so
// the customer portal, the sign in page, and every other page outside the
// staff app never follow a staff theme or dark mode.
//
// The style comes after the root layout's in the page, so its values win
// here, and next-themes sets the light or dark class before anything
// paints: Light and Dark are forced from the saved mode, and Match my
// computer follows the system setting.
export function StaffTheme({ theme, children }: { theme: ResolvedTheme; children: ReactNode }) {
  return (
    <>
      {/* Only hex colors and fixed overlays reach this (themeDeclarations) */}
      <style id="ps-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      <ThemeProvider attribute="class" enableSystem forcedTheme={forcedThemeFor(theme.mode)} defaultTheme="system" storageKey="psasync-mode">
        {children}
      </ThemeProvider>
    </>
  )
}
