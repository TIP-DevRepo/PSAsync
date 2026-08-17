"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Settings,
  Truck,
  ClipboardList,
  ShoppingCart,
} from "lucide-react"

export interface PagePermissions {
  clients?: boolean
  catalog?: boolean
  vendors?: boolean
  quotes?: boolean
  settings?: boolean
  salesOrders?: boolean
  purchaseOrders?: boolean
}

const navItems: { label: string; href: string; icon: typeof LayoutDashboard; permissionKey: keyof PagePermissions | null }[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permissionKey: null },
  { label: "Clients", href: "/dashboard/clients", icon: Users, permissionKey: "clients" },
  { label: "Vendors", href: "/dashboard/vendors", icon: Truck, permissionKey: "vendors" },
  { label: "Catalog", href: "/dashboard/catalog", icon: Package, permissionKey: "catalog" },
  { label: "Quotes", href: "/dashboard/quotes", icon: FileText, permissionKey: "quotes" },
  { label: "Sales Orders", href: "/dashboard/sales-orders", icon: ClipboardList, permissionKey: "salesOrders" },
  { label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: ShoppingCart, permissionKey: "purchaseOrders" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, permissionKey: "settings" },
]

export function Sidebar({ pagePermissions = {} }: { pagePermissions?: PagePermissions }) {
  const pathname = usePathname()

  const visibleItems = navItems.filter(
    (item) => item.permissionKey === null || pagePermissions[item.permissionKey] === true
  )

  return (
    <nav className="flex h-full flex-col gap-1 bg-sidebar p-4 text-sidebar-foreground">
      <Link
        href="/dashboard/updates"
        className="mb-6 flex items-center gap-2 px-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Features & Updates"
      >
        <Image src="/icon.png" alt="" width={20} height={20} className="rounded-sm" />
        <span className="text-lg font-bold tracking-tight">PSAsync</span>
      </Link>
      {visibleItems.map((item) => {
        const isActive = item.href === "/dashboard/settings"
          ? pathname.startsWith("/dashboard/settings")
          : pathname === item.href
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}