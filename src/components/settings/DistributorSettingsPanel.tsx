"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"

type DistributorKey = "INGRAM_MICRO" | "TD_SYNNEX" | "DH" | "AMAZON_BUSINESS"
type Environment = "SANDBOX" | "PRODUCTION"

interface DistributorSetting {
  id: string | null
  distributor: DistributorKey
  enabled: boolean
  priority: number
  activeEnvironment: Environment
  sandboxApiKey: string
  sandboxClientId: string
  sandboxClientSecret: string
  sandboxPartnerId: string
  sandboxLastTestStatus: string | null
  sandboxLastTestedAt: string | null
  productionApiKey: string
  productionClientId: string
  productionClientSecret: string
  productionPartnerId: string
  productionLastTestStatus: string | null
  productionLastTestedAt: string | null
  // Stored credentials never come back from the server, only whether each
  // one is saved. The matching sandboxApiKey/etc. fields above are just the
  // form's edit buffer for typing a new value, blank means keep the saved one.
  hasSandboxApiKey: boolean
  hasSandboxClientSecret: boolean
  hasSandboxPartnerId: boolean
  hasProductionApiKey: boolean
  hasProductionClientSecret: boolean
  hasProductionPartnerId: boolean
}

const EMPTY_SECRET_INPUTS = {
  sandboxApiKey: "",
  sandboxClientSecret: "",
  sandboxPartnerId: "",
  productionApiKey: "",
  productionClientSecret: "",
  productionPartnerId: "",
}

type SecretFieldKey = "apiKey" | "clientSecret" | "partnerId"
const SECRET_FIELDS: FieldConfig["key"][] = ["apiKey", "clientSecret", "partnerId"]

interface FieldConfig {
  key: "apiKey" | "clientId" | "clientSecret" | "partnerId"
  label: string
  hint?: string
}

const LIVE_DISTRIBUTORS: DistributorKey[] = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

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
    note: "OAuth 2.0 Client Credentials + Account Number. Strong in SMB/MSP space.",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
      { key: "apiKey", label: "Account Number", hint: "Your 10-digit D&H customer account number" },
    ],
  },
  AMAZON_BUSINESS: {
    label: "Amazon Business",
    note: "LWA refresh token flow. Useful for commodity items.",
    fields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" },
      { key: "partnerId", label: "Refresh Token", hint: "From the Solution Provider Portal" },
      { key: "apiKey", label: "Account Email", hint: "Email tied to your Amazon Business account" },
    ],
  },
}

const DISTRIBUTOR_ORDER: DistributorKey[] = ["INGRAM_MICRO", "TD_SYNNEX", "DH", "AMAZON_BUSINESS"]

function envField(env: Environment, field: string) {
  const prefix = env === "SANDBOX" ? "sandbox" : "production"
  return `${prefix}${field.charAt(0).toUpperCase()}${field.slice(1)}` as keyof DistributorSetting
}

function storedField(env: Environment, field: SecretFieldKey) {
  const prefix = env === "SANDBOX" ? "Sandbox" : "Production"
  return `has${prefix}${field.charAt(0).toUpperCase()}${field.slice(1)}` as keyof DistributorSetting
}

export function DistributorSettingsPanel() {
  const [settings, setSettings] = useState<Record<DistributorKey, DistributorSetting> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"forbidden" | "failed" | null>(null)
  const [savingKey, setSavingKey] = useState<DistributorKey | null>(null)
  const [testingKey, setTestingKey] = useState<DistributorKey | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; status: string; environment: Environment }>>({})
  // Which environment's credential fields are currently being VIEWED/EDITED
  // per distributor — independent from which one is actually active/in-use
  const [viewingEnv, setViewingEnv] = useState<Record<DistributorKey, Environment>>({
    INGRAM_MICRO: "SANDBOX",
    TD_SYNNEX: "SANDBOX",
    DH: "SANDBOX",
    AMAZON_BUSINESS: "SANDBOX",
  })

  useEffect(() => {
    fetch("/api/distributor-settings")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(res.status === 403 ? "forbidden" : "failed")
          setLoading(false)
          return
        }
        const list: DistributorSetting[] = await res.json()
        const map = {} as Record<DistributorKey, DistributorSetting>
        const initialView = {} as Record<DistributorKey, Environment>
        list.forEach((d) => {
          map[d.distributor] = { ...d, ...EMPTY_SECRET_INPUTS }
          initialView[d.distributor] = d.activeEnvironment ?? "SANDBOX"
        })
        setSettings(map)
        setViewingEnv(initialView)
        setLoading(false)
      })
      .catch(() => {
        setLoadError("failed")
        setLoading(false)
      })
  }, [])

  // Takes the saved record the server sends back (has* flags, no secrets)
  // and clears whatever was typed into the secret inputs
  function applySaved(key: DistributorKey, saved: Partial<DistributorSetting>) {
    setSettings((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...saved, ...EMPTY_SECRET_INPUTS } } : prev))
  }

  function update(key: DistributorKey, field: keyof DistributorSetting, value: string | number | boolean) {
    if (!settings) return
    setSettings({
      ...settings,
      [key]: { ...settings[key], [field]: value },
    })
  }

  async function handleSave(key: DistributorKey, silent = false) {
    if (!settings) return
    setSavingKey(key)

    const s = settings[key]
    const env = viewingEnv[key]

    const res = await fetch(`/api/distributor-settings/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: s.enabled,
        priority: s.priority,
        environment: env,
        apiKey: s[envField(env, "apiKey")],
        clientId: s[envField(env, "clientId")],
        clientSecret: s[envField(env, "clientSecret")],
        partnerId: s[envField(env, "partnerId")],
      }),
    })

    setSavingKey(null)
    const data = await res.json().catch(() => ({}))
    if (res.ok) applySaved(key, data)
    if (!silent) {
      if (res.ok) {
        toast.success(`${DISTRIBUTOR_META[key].label} settings saved`)
      } else {
        toast.error(`Couldn't save ${DISTRIBUTOR_META[key].label} settings`, data.error)
      }
    }
  }

  async function handleRemove(key: DistributorKey, field: FieldConfig) {
    const env = viewingEnv[key]
    const envLabel = env === "SANDBOX" ? "Sandbox" : "Production"
    const confirmed = await confirmDialog({
      title: `Remove the saved ${field.label}?`,
      description: `The ${DISTRIBUTOR_META[key].label} ${envLabel} ${field.label} will be deleted. Searches using this environment will stop working until a new one is saved.`,
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed || !settings) return

    const res = await fetch(`/api/distributor-settings/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: settings[key].enabled,
        priority: settings[key].priority,
        environment: env,
        clearFields: [field.key],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      applySaved(key, data)
      toast.success(`${field.label} removed`)
    } else {
      toast.error(`Couldn't remove ${field.label}`, data.error)
    }
  }

  async function handleTest(key: DistributorKey) {
    await handleSave(key, true)

    setTestingKey(key)
    const env = viewingEnv[key]
    const res = await fetch(`/api/distributor-settings/${key}/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env }),
    })
    const result = await res.json().catch(() => ({}))
    setTestingKey(null)
    if (!res.ok) {
      toast.error(`Couldn't test ${DISTRIBUTOR_META[key].label}`, result.error)
      return
    }
    setTestResults((prev) => ({ ...prev, [key]: result }))
  }

  async function handleSetActive(key: DistributorKey, targetEnv: Environment) {
    if (!settings) return
    const current = settings[key].activeEnvironment

    if (current === "PRODUCTION" && targetEnv === "SANDBOX") {
      const confirmed = await confirmDialog({
        title: `Switch ${DISTRIBUTOR_META[key].label} from Production to Sandbox?`,
        description:
          "This distributor will stop returning real pricing/availability and start using " +
          "sandbox (test) data everywhere it's used — quote builder searches, price lookups, everything.",
        confirmLabel: "Switch to Sandbox",
        variant: "danger",
      })
      if (!confirmed) return
    }

    const res = await fetch(`/api/distributor-settings/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: settings[key].enabled,
        priority: settings[key].priority,
        activeEnvironment: targetEnv,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(`Couldn't switch ${DISTRIBUTOR_META[key].label}`, data.error)
      return
    }

    toast.success(`${DISTRIBUTOR_META[key].label} is now active on ${targetEnv === "PRODUCTION" ? "Production" : "Sandbox"}`)
    update(key, "activeEnvironment", targetEnv)
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }
  if (loadError === "forbidden") {
    return <SettingsNoAccess />
  }
  if (loadError || !settings) {
    return <p className="text-sm text-zinc-500">Couldn&apos;t load distributor settings. Refresh the page to try again.</p>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        Connect distributor accounts so you can search live pricing and availability
        from the quote builder. Priority controls which distributor&apos;s results show
        first when searching all of them at once.
      </p>

      {DISTRIBUTOR_ORDER.map((key) => {
        const s = settings[key]
        const meta = DISTRIBUTOR_META[key]
        const result = testResults[key]
        const isLive = LIVE_DISTRIBUTORS.includes(key)
        const env = viewingEnv[key]
        const lastTestStatus = s[envField(env, "lastTestStatus")] as string | null
        const lastTestedAt = s[envField(env, "lastTestedAt")] as string | null

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

            {isLive && (
              <div className="flex items-center gap-1 rounded-md border p-1 w-fit text-xs">
                {(["SANDBOX", "PRODUCTION"] as Environment[]).map((e) => {
                  const isViewing = env === e
                  const isActive = s.activeEnvironment === e
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setViewingEnv((prev) => ({ ...prev, [key]: e }))}
                      className={`flex items-center gap-1.5 rounded px-2 py-1 ${
                        isViewing ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"
                      }`}
                    >
                      {e === "SANDBOX" ? "Sandbox" : "Production"}
                      {isActive && (
                        <span className="rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Active
                        </span>
                      )}
                    </button>
                  )
                })}
                {s.activeEnvironment !== env && (
                  <button
                    type="button"
                    onClick={() => handleSetActive(key, env)}
                    className="ml-1 rounded px-2 py-1 text-blue-600 hover:underline"
                  >
                    Set as Active
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {meta.fields.map((f) => {
                const isStored =
                  SECRET_FIELDS.includes(f.key) && !!s[storedField(env, f.key as SecretFieldKey)]
                return (
                  <div key={f.key}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-sm font-medium">{f.label}</label>
                      {isStored && (
                        <span className="flex items-center gap-2">
                          <span className="rounded-full bg-brand-secondary-500/10 px-2 py-0.5 text-xs font-medium text-brand-secondary-500">
                            Saved
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemove(key, f)}
                            className="text-xs text-zinc-500 hover:underline"
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </div>
                    <input
                      type="password"
                      value={(s[envField(env, f.key)] as string | null) ?? ""}
                      onChange={(e) => update(key, envField(env, f.key), e.target.value)}
                      placeholder={isStored ? "Leave blank to keep the saved value" : undefined}
                      autoComplete="new-password"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    {f.hint && <p className="text-xs text-zinc-500 mt-1">{f.hint}</p>}
                  </div>
                )
              })}

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

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-zinc-500">
                {lastTestedAt
                  ? `Last tested (${env === "SANDBOX" ? "Sandbox" : "Production"}): ${new Date(lastTestedAt).toLocaleString()}`
                  : `Never tested (${env === "SANDBOX" ? "Sandbox" : "Production"})`}
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
              <p className={`text-xs ${result.success ? "text-green-600" : "text-red-600"}`}>
                {result.status}
              </p>
            )}
            {!result && lastTestStatus && (
              <p className="text-xs text-zinc-400">{lastTestStatus}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}