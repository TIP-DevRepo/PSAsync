"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Bell, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { confirmDialog } from "@/lib/confirm-dialog"

interface Notification {
  id: string
  type: "QUOTE_VIEWED" | "QUOTE_APPROVED" | "QUOTE_LOST"
  message: string
  link: string | null
  read: boolean
  createdAt: string
}

const TYPE_ICON: Record<Notification["type"], string> = {
  QUOTE_VIEWED: "👀",
  QUOTE_APPROVED: "✅",
  QUOTE_LOST: "❌",
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const load = useCallback(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        if (data.notifications) setNotifications(data.notifications)
        if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    // Poll every 30s so a rep sees a new "quote viewed" without refreshing
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  async function handleClickNotification(n: Notification) {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
      fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).catch(() => {})
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    await fetch("/api/notifications/mark-all-read", { method: "POST" }).catch(() => {})
  }

  async function handleDeleteNotification(e: React.MouseEvent, notificationId: string) {
    e.stopPropagation()
    const wasUnread = !notifications.find((n) => n.id === notificationId)?.read
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1))
    await fetch(`/api/notifications/${notificationId}`, { method: "DELETE" }).catch(() => {})
  }

  async function handleClearAll() {
    const confirmed = await confirmDialog({
      title: "Clear all notifications?",
      description: "This can't be undone.",
      confirmLabel: "Clear All",
      variant: "danger",
    })
    if (!confirmed) return
    setNotifications([])
    setUnreadCount(0)
    await fetch("/api/notifications/clear-all", { method: "POST" }).catch(() => {})
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-danger-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 bg-popover border-border shadow-popover">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          )}
          {notifications.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onClick={() => handleClickNotification(n)}
              className={`flex items-start gap-2 py-2 group ${!n.read ? "bg-surface-hover" : ""}`}
            >
              <span className="mt-0.5">{TYPE_ICON[n.type]}</span>
              <span className="flex-1 text-sm text-foreground">
                {n.message}
                <span className="block text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
              <button
                onClick={(e) => handleDeleteNotification(e, n.id)}
                title="Delete"
                className="mt-0.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-danger"
              >
                <X size={14} />
              </button>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}