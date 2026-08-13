"use client"

import { useState, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"

const Lightfall = dynamic(() => import("@/components/effects/Lightfall"), { ssr: false })

// Defined once, outside the component, so this array's reference never
// changes between renders — passing a fresh inline array literal here
// instead would give Lightfall's internal useEffect a "new" colors prop
// on every keystroke (since typing re-renders LoginPage), causing it to
// tear down and rebuild the entire WebGL renderer from scratch each time.
const LIGHTFALL_COLORS = ["#2E86AB", "#1B3A5C", "#A6C8FF"]

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginPage />
    </Suspense>
  )
}

function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState<"email" | "password">("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const ssoError = searchParams.get("error")
  const ssoErrorMessages: Record<string, string> = {
    no_account_found: "No PetaCore account was found for your Microsoft email. Ask an admin to invite you first.",
    sso_not_available: "Single sign-on isn't set up for your company yet.",
    invalid_state: "That sign-in attempt expired. Please try again.",
    token_exchange_failed: "Microsoft sign-in failed. Please try again.",
    could_not_read_profile: "Couldn't read your Microsoft profile. Please try again.",
    no_email_on_account: "Your Microsoft account doesn't have an email address PetaCore can use.",
  }

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const res = await fetch("/api/sso/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()

    if (data.ssoRequired) {
      window.location.href = `/api/sso/start?email=${encodeURIComponent(email)}`
      return
    }

    setStep("password")
    setLoading(false)
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError("Invalid email or password")
      setLoading(false)
    } else {
      router.push("/dashboard")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Lightfall
          colors={LIGHTFALL_COLORS}
          backgroundColor="#0F2038"
          speed={0.4}
          streakCount={2}
          streakWidth={1}
          streakLength={1}
          glow={1}
          density={0.6}
          twinkle={1}
          zoom={3}
          backgroundGlow={0.5}
          opacity={0.9}
          mouseInteraction
          mouseStrength={0.4}
          mouseRadius={1}
        />
      </div>
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-md relative z-10">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">PetaCore</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to your account</p>

        {ssoError && (
          <p className="text-red-500 text-sm mb-4">
            {ssoErrorMessages[ssoError] || "Something went wrong signing in. Please try again."}
          </p>
        )}

        {step === "email" && (
          <form onSubmit={handleEmailContinue} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-500"
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-900">{email}</p>
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Change
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-500"
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}