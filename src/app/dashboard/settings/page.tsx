"use client"

import { useState, useEffect, useLayoutEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, Building2, UserCog, FileText, Bell, Plug, ShieldCheck, Mail, ClipboardList, Briefcase, Tags, MapPin, Target, UsersRound, MousePointerClick, History } from "lucide-react"
import { cn } from "@/lib/utils"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { CompanySettingsPanel } from "@/components/settings/CompanySettingsPanel"
import { IndustriesSettingsPanel } from "@/components/settings/IndustriesSettingsPanel"
import { CategoriesSettingsPanel } from "@/components/settings/CategoriesSettingsPanel"
import { ContactTagsSettingsPanel } from "@/components/settings/ContactTagsSettingsPanel"
import { UsersSettingsPanel } from "@/components/settings/UsersSettingsPanel"
import { RolesPermissionsPanel } from "@/components/settings/RolesPermissionsPanel"
import { QuoteSettingsPanel } from "@/components/settings/QuoteSettingsPanel"
import { ApprovalWorkflowsPanel } from "@/components/settings/ApprovalWorkflowsPanel"
import { NotificationSettingsPanel } from "@/components/settings/NotificationSettingsPanel"
import { DistributorSettingsPanel } from "@/components/settings/DistributorSettingsPanel"
import { MicrosoftSettingsPanel } from "@/components/settings/MicrosoftSettingsPanel"
import { SalesOrderSettingsPanel } from "@/components/settings/SalesOrderSettingsPanel"
import { OpportunitySettingsPanel } from "@/components/settings/OpportunitySettingsPanel"
import { TeamsSettingsPanel } from "@/components/settings/TeamsSettingsPanel"
import { ActionButtonsSettingsPanel } from "@/components/settings/ActionButtonsSettingsPanel"
import { AuditLogSettingsPanel } from "@/components/settings/AuditLogSettingsPanel"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import { NoAccess } from "@/components/NoAccess"
import { useAccess } from "@/components/AccessProvider"

type PanelKey =
  | "company"
  | "users"
  | "roles"
  | "teams"
  | "industries"
  | "contactTags"
  | "categories"
  | "salesOrders"
  | "opportunities"
  | "actionButtons"
  | "quotes"
  | "approval-workflows"
  | "notifications"
  | "distributors"
  | "microsoft"
  | "auditLog"

interface SettingsItem {
  key: PanelKey
  label: string
  icon: typeof Building2
}

interface SettingsCategory {
  label: string
  items: SettingsItem[]
}

const settingsCategories: SettingsCategory[] = [
  {
    label: "Company Settings",
    items: [{ key: "company", label: "Company Info & Branding", icon: Building2 }],
  },
  {
    label: "Users",
    items: [
      { key: "users", label: "Manage Users", icon: UserCog },
      { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
      { key: "teams", label: "Teams", icon: UsersRound },
    ],
  },
  {
    label: "Clients",
    items: [
      { key: "industries", label: "Industries", icon: Briefcase },
      { key: "contactTags", label: "Contact Tags", icon: Briefcase },
    ],
  },
  {
    label: "Product Catalog",
    items: [{ key: "categories", label: "Categories", icon: Tags }],
  },
  {
    label: "Quotes",
    items: [
      { key: "quotes", label: "Quote Settings", icon: FileText },
      { key: "approval-workflows", label: "Approval Workflows", icon: ShieldCheck },
    ],
  },
  {
    label: "Opportunities",
    items: [
      { key: "opportunities", label: "Opportunity Settings", icon: Target },
      { key: "actionButtons", label: "Action Buttons", icon: MousePointerClick },
    ],
  },
  {
    label: "Sales Orders",
    items: [{ key: "salesOrders", label: "Sales Order Settings", icon: ClipboardList }],
  },
  {
    label: "Notifications",
    items: [{ key: "notifications", label: "Notification Workflows", icon: Bell }],
  },
  {
    label: "Integrations",
    items: [
      { key: "distributors", label: "Distributor Integrations", icon: Plug },
      { key: "microsoft", label: "Microsoft / Outlook Integration", icon: Mail },
    ],
  },
  {
    label: "Audit",
    items: [{ key: "auditLog", label: "Audit Log", icon: History }],
  },
]

// The permission each panel needs, matching the API rules behind it. null
// means anyone who can open Settings: the Microsoft panel lets every user
// connect and disconnect their own mailbox, and shows the app credentials
// and Single Sign-On only with Integrations access.
const PANEL_PERMISSION: Record<PanelKey, string | null> = {
  company: "settingsSections.company",
  users: "settingsSections.users",
  roles: "settingsSections.users",
  teams: "settingsSections.teams",
  industries: "settingsSections.company",
  contactTags: "settingsSections.company",
  categories: "settingsSections.company",
  salesOrders: "settingsSections.salesOrders",
  opportunities: "settingsSections.opportunities",
  actionButtons: "settingsSections.actionButtons",
  quotes: "settingsSections.quotes",
  "approval-workflows": "settingsSections.approvalWorkflows",
  notifications: "settingsSections.notifications",
  distributors: "settingsSections.integrations",
  microsoft: null,
  auditLog: "auditLog.view",
}

const ITEM_LOOKUP = {} as Record<PanelKey, { label: string; category: string }>
settingsCategories.forEach((cat) => {
  cat.items.forEach((item) => {
    ITEM_LOOKUP[item.key] = { label: item.label, category: cat.label }
  })
})

function categoryPanelId(label: string) {
  return `settings-accordion-panel-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function renderPanel(key: PanelKey | null) {
  switch (key) {
    case "company":
      return <CompanySettingsPanel />
    case "users":
      return <UsersSettingsPanel />
      case "roles":
      return <RolesPermissionsPanel />
    case "teams":
      return <TeamsSettingsPanel />
        case "industries":
      return <IndustriesSettingsPanel />
    case "categories":
      return <CategoriesSettingsPanel />
    case "contactTags":
      return <ContactTagsSettingsPanel />
    case "salesOrders":
      return <SalesOrderSettingsPanel />
    case "opportunities":
      return <OpportunitySettingsPanel />
    case "actionButtons":
      return <ActionButtonsSettingsPanel />
    case "quotes":
      return <QuoteSettingsPanel />
    case "approval-workflows":
      return <ApprovalWorkflowsPanel />
    case "notifications":
      return <NotificationSettingsPanel />
    case "distributors":
      return <DistributorSettingsPanel />
    case "microsoft":
      return <MicrosoftSettingsPanel />
    case "auditLog":
      return <AuditLogSettingsPanel />
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Select a setting from the left to get started.
        </p>
      )
  }
}

export default function SettingsIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full">
          <Breadcrumbs items={[{ label: "Settings", href: "/dashboard/settings" }]} current={null} />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  )
}

function SettingsPageContent() {
  const { can } = useAccess()
  if (!can("pages.settings")) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[]} current="Settings" />
        <NoAccess />
      </div>
    )
  }
  return <SettingsPanels />
}

function SettingsPanels() {
  const searchParams = useSearchParams()
  const { can } = useAccess()

  // Only the panels this user may use are listed. Global Admin sees all.
  const canUsePanel = (key: PanelKey) => {
    const permission = PANEL_PERMISSION[key]
    return permission === null || can(permission)
  }
  const visibleCategories = settingsCategories
    .map((cat) => ({ ...cat, items: cat.items.filter((item) => canUsePanel(item.key)) }))
    .filter((cat) => cat.items.length > 0)
  const firstVisible = visibleCategories[0] ?? null

  const [openCategory, setOpenCategory] = useState<string | null>(firstVisible?.label ?? null)
  const [selectedKey, setSelectedKey] = useState<PanelKey | null>(firstVisible?.items[0].key ?? null)

  function toggleCategory(label: string) {
    const btn = headerRefs.current[label]
    if (btn) {
      scrollAnchor.current = { label, top: btn.getBoundingClientRect().top }
    }
    setOpenCategory((prev) => (prev === label ? null : label))
  }

  useEffect(() => {
    const panel = searchParams.get("panel") as PanelKey | null
    if (panel && ITEM_LOOKUP[panel]) {
      setOpenCategory(ITEM_LOOKUP[panel].category)
      setSelectedKey(panel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const headerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const scrollAnchor = useRef<{ label: string; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!scrollAnchor.current) return
    const { label, top } = scrollAnchor.current
    const btn = headerRefs.current[label]
    scrollAnchor.current = null
    if (!btn) return
    const newTop = btn.getBoundingClientRect().top
    const delta = newTop - top
    if (delta !== 0) window.scrollBy(0, delta)
  }, [openCategory])

  const selected = selectedKey ? ITEM_LOOKUP[selectedKey] : null

  if (!firstVisible) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[]} current="Settings" />
        <h1 className="text-display font-semibold tracking-tight text-foreground">Settings</h1>
        <NoAccess
          title="You do not have access to any settings"
          description="Ask an administrator if you need to change company settings."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Follows the selected section, which starts from ?panel= and changes as the user picks another. */}
      <Breadcrumbs
        items={selected ? [{ label: "Settings", href: "/dashboard/settings" }] : []}
        current={selected ? selected.label : "Settings"}
      />
      <h1 className="text-display font-semibold tracking-tight text-foreground">Settings</h1>

      <div className="flex gap-6 items-start">
        {/* Left panel — accordion */}
        <div className="w-72 flex-shrink-0 space-y-2">
          {visibleCategories.map((category) => {
            const isOpen = openCategory === category.label
            const panelId = categoryPanelId(category.label)
            return (
              <div key={category.label} className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
                <button
                  ref={(el) => {
                    headerRefs.current[category.label] = el
                  }}
                  onClick={() => toggleCategory(category.label)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  {category.label}
                  <ChevronDown
                    className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300 ease-out", isOpen && "rotate-180 text-primary")}
                  />
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-hidden={!isOpen}
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-border px-4 py-2 flex flex-col gap-1">
                      {category.items.map((item) => {
                        const ItemIcon = item.icon
                        const isSelected = selectedKey === item.key
                        return (
                          <button
                            key={item.key}
                            onClick={() => setSelectedKey(item.key)}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors",
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                            )}
                          >
                            <ItemIcon className="h-4 w-4" />
                            {item.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right panel — selected setting's content */}
        <div className="flex-1 min-w-0 rounded-lg border border-border bg-card shadow-card p-6">
          {selected && (
            <div className="mb-4">
              <p className="text-caption text-muted-foreground uppercase tracking-wide">{selected.category}</p>
              <h2 className="text-heading font-semibold text-foreground">{selected.label}</h2>
            </div>
          )}
          {/* A direct link (?panel=) to a panel the user may not use */}
          {selectedKey && !canUsePanel(selectedKey) ? <SettingsNoAccess /> : renderPanel(selectedKey)}
        </div>
      </div>
    </div>
  )
}