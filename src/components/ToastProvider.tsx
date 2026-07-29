"use client"

import { useEffect, useState } from "react"
import { Toast } from "@heroui/react"

export function AppToastProvider() {
  const [placement, setPlacement] = useState<"bottom end" | "top">("bottom end")

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const update = () => setPlacement(mq.matches ? "top" : "bottom end")
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  return <Toast.Provider placement={placement} maxVisibleToasts={3} />
}