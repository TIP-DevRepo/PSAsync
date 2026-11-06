import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes"
import { AppToastProvider } from "@/components/ToastProvider"
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider"
import { PromptDialogProvider } from "@/components/PromptDialogProvider"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { loadAppearance } from "@/lib/appearance"
import { forcedThemeFor, resolveTheme, themeCss } from "@/lib/theme"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth()
  let companyName: string | null = null

  if (session?.user?.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: session.user.companyId },
      select: { name: true },
    })
    companyName = company?.name ?? null
  }

  return {
    title: companyName ? `PSAsync: ${companyName}` : "PSAsync",
    description: "Multi-tenant PSA platform",
  }
}

// The theme (src/lib/theme.ts) is written into the page on the server, so
// the first paint already has the right colors: the --ps-* variables on the
// html element for both modes, and next-themes setting the light or dark
// class before anything shows. A signed in user's mode is their saved
// choice (or the company's): Light and Dark are forced, and Match my
// computer follows the system setting. Without a session (sign in, the
// customer portal) the PSAsync default theme applies and the mode works as
// it did before.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth()
  const appearance = session?.user?.id ? await loadAppearance(session.user.id) : null
  const theme = appearance?.theme ?? resolveTheme(null, null)
  const themeProps = appearance
    ? { forcedTheme: forcedThemeFor(theme.mode), defaultTheme: "system", storageKey: "psasync-mode" }
    : { defaultTheme: "dark" }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Only hex colors and fixed overlays reach this (themeDeclarations) */}
        <style id="ps-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" enableSystem {...themeProps}>
          <AppToastProvider />
          <ConfirmDialogProvider />
          <PromptDialogProvider />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
