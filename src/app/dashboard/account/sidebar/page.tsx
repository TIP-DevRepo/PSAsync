import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { MySidebar } from "@/components/sidebar-layout/MySidebar"

// My settings > Sidebar. Every signed in user, for their own layout only
// (the session's user, never an id from the URL), like the rest of My
// settings. The page loads its data from GET /api/account/sidebar.
export default async function SidebarPreferencesPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }
  return <MySidebar />
}
