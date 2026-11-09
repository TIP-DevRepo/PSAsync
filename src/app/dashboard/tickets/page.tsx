import { Suspense } from "react"
import { auth } from "@/auth"
import { checkAccess } from "@/lib/access-check"
import { NoAccess } from "@/components/NoAccess"
import { TicketsPage } from "@/components/tickets/TicketsPage"

// Checked on the server from the same session the sidebar reads: without
// the Tickets page the client page is never rendered, only the NoAccess
// every other guarded page shows
export default async function TicketsRoute() {
  const session = await auth()
  if (!checkAccess(session?.user?.access, "pages.tickets")) return <NoAccess />

  // The view, filters, sort, and page live in the URL (useSearchParams)
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <TicketsPage />
    </Suspense>
  )
}
