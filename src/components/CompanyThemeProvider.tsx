import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Fetches the current company's brand colors ONCE per request and injects
// them as CSS variable overrides. Every page automatically reflects the
// company's actual branding through the --brand-primary-base /
// --brand-accent-base variables defined in globals.css — nothing else
// needs to fetch company colors itself. Renders nothing visible; on pages
// with no session (login, public portal links), it silently does nothing
// and the fallback colors in globals.css apply instead.
export async function CompanyThemeProvider() {
  const session = await auth()
  if (!session?.user?.companyId) return null

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.user.companyId },
    select: { primaryColor: true, accentColor: true },
  })

  if (!settings?.primaryColor && !settings?.accentColor) return null

  // Only ever accept a real hex color (#rgb, #rrggbb, or #rrggbbaa) before
  // it gets injected into raw HTML below — this value should always come
  // from an <input type="color">, but validating here means a malformed
  // or malicious value stored some other way (direct API call, manual DB
  // edit) can never break out of the <style> tag.
  const isValidHexColor = (value: string) => /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)

  const overrides: string[] = []
  if (settings.primaryColor && isValidHexColor(settings.primaryColor)) {
    overrides.push(`--brand-primary-base: ${settings.primaryColor};`)
  }
  if (settings.accentColor && isValidHexColor(settings.accentColor)) {
    overrides.push(`--brand-secondary-base: ${settings.accentColor};`)
  }

  if (overrides.length === 0) return null

  return (
    <style
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: `:root { ${overrides.join(" ")} }` }}
    />
  )
}