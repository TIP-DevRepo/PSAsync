import { Suspense } from "react"
import { auth } from "@/auth"
import { checkAccess } from "@/lib/access-check"
import { NoAccess } from "@/components/NoAccess"
import { OpportunitiesPage } from "@/components/opportunities/OpportunitiesPage"

// Checked on the server from the same session the sidebar reads: without
// the Opportunities page the client page is never rendered, only the
// NoAccess every other guarded page shows
export default async function OpportunitiesRoute() {
  const session = await auth()
  if (!checkAccess(session?.user?.access, "pages.opportunities")) return <NoAccess />

  // The view and filters live in the URL (useSearchParams)
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <OpportunitiesPage />
    </Suspense>
  )
}
