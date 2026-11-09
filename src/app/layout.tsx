import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppToastProvider } from "@/components/ToastProvider"
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider"
import { PromptDialogProvider } from "@/components/PromptDialogProvider"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { publicThemeCss } from "@/lib/theme"
import { PublicLightMode } from "@/components/PublicLightMode"

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

// Every page starts from the PSAsync default theme in light mode, written
// here on the server: the customer portal, sign in, and every other page
// outside the staff app always look like this, whatever the company, the
// user, or the computer prefers. The staff app (src/app/dashboard/layout.tsx)
// adds the signed in user's own theme and mode on top (StaffTheme).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} light h-full antialiased`}
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <head>
        {/* Fixed: the light PSAsync default, never a company or user value */}
        <style id="ps-theme-public" dangerouslySetInnerHTML={{ __html: publicThemeCss() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PublicLightMode />
        <AppToastProvider />
        <ConfirmDialogProvider />
        <PromptDialogProvider />
        {children}
      </body>
    </html>
  );
}
