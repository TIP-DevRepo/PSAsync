import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard"
import { LogOutLink } from "@/components/account/LogOutLink"

// Where a user still on an admin's temporary password is sent by the
// dashboard layout. Deliberately outside that layout, so there's no sidebar
// or top bar to wander off through. Uses the same POST /api/account/password
// as My Account, which clears the gate in the same update as the password.
export default async function ChangePasswordPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  // Anyone who doesn't need to be here goes straight to the app
  if (!session.user.access?.mustChangePassword) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-display font-semibold tracking-tight text-foreground">PSAsync</h1>
        <ChangePasswordCard
          description="Your administrator set a temporary password. Choose your own password to continue."
          redirectTo="/dashboard"
        />
        <div className="flex justify-center">
          <LogOutLink />
        </div>
      </div>
    </div>
  )
}
