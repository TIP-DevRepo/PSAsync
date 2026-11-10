import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronRight, PanelLeft, Palette } from "lucide-react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { usesMicrosoftSso } from "@/lib/sso-account"
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard"
import { LogOutLink } from "@/components/account/LogOutLink"
import { IconTile, PageHeader } from "@/components/ui/blocks"

// My settings: every signed in user can reach their own, so this is
// deliberately not gated by any Roles & Permissions page permission. The
// sidebar's user menu opens it, and Log out is here too. Laid out as a
// plain stack of cards so per-user preferences can be added as more cards.
export default async function AccountPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      company: { select: { settings: { select: { ssoEnabled: true } } } },
    },
  })
  if (!user) {
    redirect("/login")
  }

  const isSso = usesMicrosoftSso(user.company.settings)

  return (
    <div className="w-full max-w-2xl space-y-6">
      <PageHeader
        breadcrumbs={{ current: "My settings" }}
        title="My settings"
        subtitle="Your profile, sign in details, and how PSAsync looks for you."
        actions={<LogOutLink />}
      />

      <section className="rounded-lg border border-border bg-card shadow-card p-6 space-y-4">
        <h2 className="text-heading font-semibold text-foreground">Profile</h2>
        <dl className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground mb-1">Name</dt>
            <dd className="text-foreground">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground mb-1">Email</dt>
            <dd className="text-foreground break-all">{user.email}</dd>
          </div>
        </dl>
      </section>

      <Link
        href="/dashboard/account/appearance"
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconTile icon={Palette} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-foreground">Appearance</span>
          <span className="block text-sm text-muted-foreground">Accent color, sidebar style, light or dark mode, and row density</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/dashboard/account/sidebar"
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconTile icon={PanelLeft} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-foreground">Sidebar</span>
          <span className="block text-sm text-muted-foreground">Page order, folders, and the views Opportunities and Tickets open on</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      {isSso ? (
        <section className="rounded-lg border border-border bg-card shadow-card p-6 space-y-2">
          <h2 className="text-heading font-semibold text-foreground">Password</h2>
          <p className="text-sm text-muted-foreground">
            Your account signs in with Microsoft, so your password is managed there.
          </p>
        </section>
      ) : (
        <ChangePasswordCard />
      )}
    </div>
  )
}
