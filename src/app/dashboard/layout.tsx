import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Sidebar, type PagePermissions } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { resolvePagePermissions } from "@/lib/permissions"

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

  return (
    <div className="flex h-screen">
      {/* Sidebar — permanent on desktop, hidden on mobile */}
      <aside className="hidden w-64 border-r border-sidebar-border md:block">
        <Sidebar pagePermissions={pagePermissions} />
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar userName={session.user.name ?? "User"} pagePermissions={pagePermissions} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}