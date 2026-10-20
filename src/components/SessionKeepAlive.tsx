"use client"

import { useEffect } from "react"
import { SESSION_REFRESH_SECONDS } from "@/lib/session-config"

// Auth.js only re-issues the sign in cookie, moving its idle expiry
// forward, when /api/auth/session is fetched. Page loads and API calls read
// the session without renewing it, so without this an active user would be
// signed out SESSION_IDLE_SECONDS after signing in. Mounted once by the
// dashboard layout: it fetches the session at most once per
// SESSION_REFRESH_SECONDS per browser, checked on load and hourly while a
// tab stays open. The absolute cap still applies (src/auth.ts).
const LAST_REFRESH_KEY = "psasync.sessionRefreshedAt"
const CHECK_EVERY_MS = 60 * 60 * 1000

let lastRefreshInMemory = 0

function readLastRefresh(): number {
  try {
    return Number(localStorage.getItem(LAST_REFRESH_KEY)) || lastRefreshInMemory
  } catch {
    return lastRefreshInMemory
  }
}

function saveLastRefresh(at: number) {
  lastRefreshInMemory = at
  try {
    localStorage.setItem(LAST_REFRESH_KEY, String(at))
  } catch {
    // Private windows and blocked storage fall back to memory
  }
}

function refreshIfDue() {
  if (Date.now() - readLastRefresh() < SESSION_REFRESH_SECONDS * 1000) return
  fetch("/api/auth/session", { cache: "no-store" })
    .then((res) => {
      if (res.ok) saveLastRefresh(Date.now())
    })
    .catch(() => {
      // Offline or a blip: tried again on the next check
    })
}

export function SessionKeepAlive() {
  useEffect(() => {
    refreshIfDue()
    const timer = setInterval(refreshIfDue, CHECK_EVERY_MS)
    return () => clearInterval(timer)
  }, [])
  return null
}
