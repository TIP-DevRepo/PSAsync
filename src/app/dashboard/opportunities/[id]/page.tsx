import { auth } from "@/auth"
import { checkAccess } from "@/lib/access-check"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { NoAccess } from "@/components/NoAccess"
import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail"

// Checked on the server like the list page. An opportunity the user may
// not open is the API's 404, shown by the page as not found.
export default async function OpportunityRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!checkAccess(session?.user?.access, "pages.opportunities")) {
    return (
      <div className="w-full space-y-4">
        <Breadcrumbs items={[{ label: "Opportunities", href: "/dashboard/opportunities" }]} current="No access" />
        <NoAccess />
      </div>
    )
  }

  const { id } = await params
  return <OpportunityDetail id={id} />
}
