import { auth } from "@/auth"
import { DashboardView } from "@/components/dashboard/DashboardView"
import { allowedWidgetTypes } from "@/lib/dashboards/widgetTypes"

export default async function DashboardPage() {
  const session = await auth()
  const pagePermissions =
    (session?.user.role?.permissions as { pages?: Record<string, boolean> } | undefined)?.pages ?? {}

  return (
    <div className="w-full space-y-6">
      <h1 className="text-display font-semibold tracking-tight text-foreground">Dashboard</h1>
      <DashboardView allowedWidgetTypes={allowedWidgetTypes(pagePermissions)} />
    </div>
  )
}
