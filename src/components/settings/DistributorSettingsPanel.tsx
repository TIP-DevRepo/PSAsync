"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

type DistributorKey = "INGRAM_MICRO" | "TD_SYNNEX" | "DH" | "AMAZON_BUSINESS"

interface DistributorSetting {
  id: string | null
  distributor: DistributorKey
  enabled: boolean
  priority: number
  apiKey: string
  clientId: string
  clientSecret: string
  partnerId: string
  sandboxMode: boolean
  lastSyncedAt: string | null
  lastTestStatus: string | null
  lastTestedAt: string | null
}

interface FieldConfig {
  key: "apiKey" | "clientId" | "clientSecret" | "partnerId"
  label: string
  hint?: string
}

// Distributors with a real, working API adapter behind them. Everyone else
// still runs on mock data until their API access is approved.
const LIVE_DISTRIBUTORS: DistributorKey[] = ["INGRAM_MICRO", "TD_SYNNEX"]

const DISTRIBUTOR_META: Record<DistributorKey, { label: string; note: string; fields: FieldConfig[] }> = {
  INGRAM_MICRO: {
    label: "Ingram Micro",
    note: "OAuth 2.0 + Customer Number. Largest catalog — approval can take 1-2 weeks.",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
      { key: "apiKey", label: "IM Customer Number", hint: "e.g. 20-222222" },
    ],
  },
  TD_SYNNEX: {
    label: "TD Synnex",
    note: "OAuth 2.0 Client ID + Secret. No keyword search — exact part number lookup only.",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
    ],
  },
  DH: {
    label: "D&H",
    note: "API Key only. Strong in SMB/MSP space.",
    fields: [{ key: "apiKey", label: "API Key" }],
  },
  AMAZON_BUSINESS: {
    label: "Amazon Business",
    note: "OAuth via Amazon Seller/Business account.",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
    ],
  },
}

const DISTRIBUTOR_ORDER: DistributorKey[] = [
  "INGRAM_MICRO",
  "TD_SYNNEX",
  "DH",
  "AMAZON_BUSINESS",
]

export function DistributorSettingsPanel() {
  const [settings, setSettings] = useState<Record<DistributorKey, DistributorSetting> | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<DistributorKey | null>(null)
  const [testingKey, setTestingKey] = useState<DistributorKey | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; status: string }>>({})

  useEffect(() => {
    fetch("/api/distributor-settings")
      .then((res) => res.json())
      .then((list: DistributorSetting[]) => {
        const map = {} as Record<DistributorKey, DistributorSetting>
        list.forEach((d) => {
          map[d.distributor] = { ...d, sandboxMode: d.sandboxMode ?? true }
        })
        setSettings(map)
        setLoading(false)
      })
  }, [])

  function update(key: DistributorKey, field: string, value: string | number | boolean) {
    if (!settings) return
    setSettings({
      ...settings,
      [key]: { ...settings[key], [field]: value },
    })
  }

  async function handleSave(key: DistributorKey) {
    if (!settings) return
    setSavingKey(key)

    const s = settings[key]
    await fetch(`/api/distributor-settings/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: s.enabled,
        priority: s.priority,
        apiKey: s.apiKey,
        clientId: s.clientId,
        clientSecret: s.clientSecret,
        partnerId: s.partnerId,
        sandboxMode: s.sandboxMode,
      }),
    })

    setSavingKey(null)
  }

  async function handleTest(key: DistributorKey) {
    await handleSave(key)

    setTestingKey(key)
    const res = await fetch(`/api/distributor-settings/${key}/test-connection`, {
      method: "POST",
    })
    const result = await res.json()
    setTestResults((prev) => ({ ...prev, [key]: result }))
    setTestingKey(null)
  }

  if (loading || !settings) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        Connect distributor accounts so you can search live pricing and availability
        from the quote builder. Priority controls which distributor's results show
        first when searching all of them at once.
      </p>

      {DISTRIBUTOR_ORDER.map((key) => {
        const s = settings[key]
        const meta = DISTRIBUTOR_META[key]
        const result = testResults[key]
        const isLive = LIVE_DISTRIBUTORS.includes(key)

        return (
          <div key={key} className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm">{meta.label}</h2>
                <p className="text-xs text-zinc-500">{meta.note}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => update(key, "enabled", e.target.checked)}
                />
                Enabled
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {meta.fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-sm font-medium mb-1">{f.label}</label>
                  <input
                    type="password"
                    value={s[f.key]}
                    onChange={(e) => update(key, f.key, e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                  {f.hint && <p className="text-xs text-zinc-500 mt-1">{f.hint}</p>}
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <input
                  type="number"
                  value={s.priority}
                  onChange={(e) => update(key, "priority", Number(e.target.value))}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="text-xs text-zinc-500 mt-1">Lower number = shown first</p>
              </div>
            </div>

            {isLive && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.sandboxMode}
                  onChange={(e) => update(key, "sandboxMode", e.target.checked)}
                />
                Sandbox Mode
                <span className="text-xs text-zinc-500">
                  (test against {meta.label}&apos;s sandbox before going live in production)
                </span>
              </label>
            )}

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-zinc-500">
                {s.lastTestedAt
                  ? `Last tested: ${new Date(s.lastTestedAt).toLocaleString()}`
                  : "Never tested"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSave(key)}
                  disabled={savingKey === key}
                >
                  {savingKey === key ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleTest(key)}
                  disabled={testingKey === key}
                >
                  {testingKey === key ? "Testing..." : "Test Connection"}
                </Button>
              </div>
            </div>

            {result && (
              <p
                className={`text-xs ${
                  result.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {result.status}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}