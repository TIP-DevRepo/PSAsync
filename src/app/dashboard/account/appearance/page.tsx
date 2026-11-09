import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { COMPANY_THEME_SELECT, USER_PREFERENCES_SELECT } from "@/lib/appearance"
import { allowsUserTheme, companyTheme } from "@/lib/theme"
import { MyAppearance } from "@/components/appearance/MyAppearance"

// My settings > Appearance. Every signed in user, for their own colors and
// row density only (the session's user, never an id from the URL), like
// the rest of My settings.
export default async function AppearancePage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: { select: USER_PREFERENCES_SELECT }, company: { select: { settings: { select: COMPANY_THEME_SELECT } } } },
  })
  if (!user) {
    redirect("/login")
  }

  const settings = user.company.settings
  return (
    <MyAppearance
      initial={{
        themeAccent: user.preferences?.themeAccent ?? null,
        themeSidebar: user.preferences?.themeSidebar ?? null,
        themeMode: user.preferences?.themeMode ?? null,
        rowDensity: user.preferences?.rowDensity ?? null,
      }}
      company={companyTheme(settings)}
      allowUserTheme={allowsUserTheme(settings)}
    />
  )
}
