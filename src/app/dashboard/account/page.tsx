import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { usesMicrosoftSso } from "@/lib/sso-account"
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard"

// Every signed in user can reach their own account page, so this is
// deliberately not gated by any Roles & Permissions page permission.
// Laid out as a plain stack of cards so per-user preferences can be
// added as more cards later.
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
      <div>
        <h1 className="text-display font-semibold tracking-tight text-foreground">My Account</h1>
        <p className="text-muted-foreground mt-1">Your profile and sign-in details.</p>
      </div>

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
