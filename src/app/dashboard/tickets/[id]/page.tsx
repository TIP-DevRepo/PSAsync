import { Suspense } from "react"
import { auth } from "@/auth"
import { checkAccess } from "@/lib/access-check"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { NoAccess } from "@/components/NoAccess"
import { TicketDetail } from "@/components/tickets/TicketDetail"

// Checked on the server like the list page. A ticket the user may not open
// (or a deleted one) is the API's 404, shown by the page as not found.
export default async function TicketRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!checkAccess(session?.user?.access, "pages.tickets")) {
    return (
      <div className="w-full space-y-4">
        <Breadcrumbs items={[{ label: "Tickets", href: "/dashboard/tickets" }]} current="No access" />
        <NoAccess />
      </div>
    )
  }

  const { id } = await params
  // The open tab lives in the URL (useSearchParams)
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <TicketDetail id={id} />
    </Suspense>
  )
}
