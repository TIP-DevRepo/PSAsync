import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CompanyThemeProvider } from "@/components/CompanyThemeProvider"
import { ThemeProvider } from "next-themes"
import { AppToastProvider } from "@/components/ToastProvider"
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider"
import { PromptDialogProvider } from "@/components/PromptDialogProvider"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <CompanyThemeProvider />
          <AppToastProvider />
          <ConfirmDialogProvider />
          <PromptDialogProvider />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}