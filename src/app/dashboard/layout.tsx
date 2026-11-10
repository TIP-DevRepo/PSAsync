import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Sidebar, type PagePermissions } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { TopbarSlotsProvider } from "@/components/layout/TopbarSlots"
import { resolvePagePermissions } from "@/lib/permissions"
import { loadAppearance } from "@/lib/appearance"
import { DEFAULT_DENSITY, resolveTheme } from "@/lib/theme"
import { StaffTheme } from "@/components/StaffTheme"
import { AccessProvider } from "@/components/AccessProvider"
import { AppearanceProvider } from "@/components/AppearanceProvider"
import { DefaultViewsProvider } from "@/components/DefaultViewsProvider"
import { PSASYNC_SIDEBAR_LAYOUT } from "@/lib/sidebar-layout"
import { SessionKeepAlive } from "@/components/SessionKeepAlive"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  // Still on an admin's temporary password: nothing in the app until they
  // choose their own. Their access is already empty on the server.
  if (session.user.access?.mustChangePassword) {
    redirect("/change-password")
  }

  const pagePermissions: PagePermissions = resolvePagePermissions(session.user.access)
  // The theme, company name and logo, and row density in one lookup
  const appearance = session.user.id ? await loadAppearance(session.user.id) : null
  const layout = appearance?.sidebarLayout ?? PSASYNC_SIDEBAR_LAYOUT
  const sidebar = {
    layout,
    pagePermissions,
    companyName: appearance?.companyName ?? "PSAsync",
    logoUrl: appearance?.logoUrl ?? null,
    userName: session.user.name ?? "User",
  }

  // The signed in user's theme applies only inside the staff app; every
  // page outside it stays on the light default (src/app/layout.tsx)
  const theme = appearance?.theme ?? resolveTheme(null, null)

  return (
    <StaffTheme theme={theme}>
    <TopbarSlotsProvider>
      <div className="flex h-screen">
        <SessionKeepAlive />
        {/* Sidebar: permanent from md up, a menu button in the top bar below */}
        <aside className="hidden w-[248px] shrink-0 md:block">
          <Sidebar {...sidebar} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar {...sidebar} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-7">
            <AccessProvider access={session.user.access ?? null}>
              <AppearanceProvider rowDensity={appearance?.rowDensity ?? DEFAULT_DENSITY}>
                <DefaultViewsProvider defaultViews={layout.defaultViews}>{children}</DefaultViewsProvider>
              </AppearanceProvider>
            </AccessProvider>
          </main>
        </div>
      </div>
    </TopbarSlotsProvider>
    </StaffTheme>
  )
}
