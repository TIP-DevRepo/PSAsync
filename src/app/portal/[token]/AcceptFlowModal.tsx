"use client"

import { useState, useRef, useEffect } from "react"
import { Parisienne } from "next/font/google"
import { PORTAL_NAME_MAX } from "@/lib/portal-input"

const signatureFont = Parisienne({ weight: "400", subsets: ["latin"], display: "swap" })

interface AcceptFlowModalProps {
  token: string
  terms: string | null
  primaryColor: string
  defaultSignerName: string
  defaultClientPoNumber: string | null
  defaultShipContactName: string
  defaultShipAddress: string | null
  defaultShipCity: string | null
  defaultShipState: string | null
  defaultShipZip: string | null
  defaultShipCountry: string | null
  onClose: () => void
  onAccepted: () => void
}

export function AcceptFlowModal({
  token,
  terms,
  primaryColor,
  defaultSignerName,
  defaultClientPoNumber,
  defaultShipContactName,
  defaultShipAddress,
  defaultShipCity,
  defaultShipState,
  defaultShipZip,
  defaultShipCountry,
  onClose,
  onAccepted,
}: AcceptFlowModalProps) {
  const [signerName, setSignerName] = useState(defaultSignerName)
  const [signerLocked, setSignerLocked] = useState(!!defaultSignerName)

  const hasAddressDefault = !!(defaultShipAddress || defaultShipCity || defaultShipState || defaultShipZip)
  const [shipContactName, setShipContactName] = useState(defaultShipContactName)
  const [shipAddress, setShipAddress] = useState(defaultShipAddress ?? "")
  const [shipCity, setShipCity] = useState(defaultShipCity ?? "")
  const [shipState, setShipState] = useState(defaultShipState ?? "")
  const [shipZip, setShipZip] = useState(defaultShipZip ?? "")
  const [shipLocked, setShipLocked] = useState(hasAddressDefault)

  const [clientPoNumber, setClientPoNumber] = useState(defaultClientPoNumber ?? "")
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fontFamilyReady, setFontFamilyReady] = useState(false)

  // next/font self-hosts the font file at build time and injects a preload
  // link, so it's already loading before this component even mounts. We
  // still explicitly confirm via document.fonts.load() using the exact
  // generated font-family name before ever drawing to canvas, since canvas
  // text (unlike regular DOM text) doesn't auto-repaint when a font
  // finishes loading.
  useEffect(() => {
    let cancelled = false
    document.fonts.load(`16px ${signatureFont.style.fontFamily}`).then(() => {
      if (!cancelled) setFontFamilyReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The signature is always a live rendering of the signer's name
  useEffect(() => {
    if (!fontFamilyReady) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!signerName.trim()) return

    const fontSize = Math.min(56, Math.floor(canvas.width / (signerName.length * 0.55)))
    ctx.fillStyle = "black"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.font = `${fontSize}px ${signatureFont.style.fontFamily}`
    ctx.fillText(signerName, canvas.width / 2, canvas.height / 2)
  }, [signerName, fontFamilyReady])

  function handleSignerChange() {
    setSignerLocked(false)
    setSignerName("")
  }

  function handleAddressChange() {
    setShipLocked(false)
    setShipContactName("")
    setShipAddress("")
    setShipCity("")
    setShipState("")
    setShipZip("")
  }

  async function handleSubmit() {
    setError("")

    if (!signerName.trim()) {
      setError("Please enter your full name.")
      return
    }
    if (!termsAgreed) {
      setError("You must agree to the terms and conditions to continue.")
      return
    }

    setSubmitting(true)
    const res = await fetch(`/api/portal/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signatureType: "TYPED",
        signatureData: signerName.trim(),
        signerName: signerName.trim(),
        termsAgreed,
        clientPoNumber: clientPoNumber || null,
        shipAddress: shipAddress || null,
        shipCity: shipCity || null,
        shipState: shipState || null,
        shipZip: shipZip || null,
        shipCountry: defaultShipCountry,
        shipContactName: shipContactName || null,
      }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Something went wrong.")
      return
    }

    onAccepted()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-md w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <h2 className="text-lg font-bold">Accept Quote</h2>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">Your Full Name *</label>
            {signerLocked && (
              <button onClick={handleSignerChange} className="text-xs text-zinc-500 hover:underline">
                Change
              </button>
            )}
          </div>
          {signerLocked ? (
            <div className="rounded-md border bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {signerName}
            </div>
          ) : (
            <input
              type="text"
              value={signerName}
              maxLength={PORTAL_NAME_MAX}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Signature</label>
          <p className="text-xs text-zinc-500 mb-2">
            Automatically generated from your name above.
          </p>
          <div className="rounded-md border bg-zinc-50">
            <canvas ref={canvasRef} width={464} height={128} className="w-full h-32" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Purchase Order # (optional)</label>
          <input
            type="text"
            value={clientPoNumber}
            maxLength={PORTAL_NAME_MAX}
            onChange={(e) => setClientPoNumber(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">Shipping Address</label>
            {shipLocked && (
              <button onClick={handleAddressChange} className="text-xs text-zinc-500 hover:underline">
                Change
              </button>
            )}
          </div>
          {shipLocked ? (
            <div className="rounded-md border bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              <p className="font-medium">{shipContactName || "—"}</p>
              <p>{shipAddress || "—"}</p>
              <p>{[shipCity, shipState, shipZip].filter(Boolean).join(", ")}</p>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={shipContactName}
                maxLength={PORTAL_NAME_MAX}
                onChange={(e) => setShipContactName(e.target.value)}
                placeholder="Point of Contact"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={shipAddress}
                maxLength={PORTAL_NAME_MAX}
                onChange={(e) => setShipAddress(e.target.value)}
                placeholder="Address"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={shipCity}
                  maxLength={PORTAL_NAME_MAX}
                  onChange={(e) => setShipCity(e.target.value)}
                  placeholder="City"
                  className="rounded-md border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={shipState}
                  maxLength={PORTAL_NAME_MAX}
                  onChange={(e) => setShipState(e.target.value)}
                  placeholder="State"
                  className="rounded-md border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={shipZip}
                  maxLength={PORTAL_NAME_MAX}
                  onChange={(e) => setShipZip(e.target.value)}
                  placeholder="Zip"
                  className="rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
        </div>

        {terms && (
          <div>
            <label className="block text-sm font-medium mb-1">Terms & Conditions</label>
            {/* Only ever a terms string from an API response, sanitized on the server
                (src/lib/sanitize-terms.ts). Never render anything else here. */}
            <div
              className="rounded-md border p-3 text-xs text-zinc-600 max-h-32 overflow-y-auto bg-zinc-50 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 last:[&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: terms }}
            />
          </div>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={termsAgreed}
            onChange={(e) => setTermsAgreed(e.target.checked)}
            required
            className="mt-0.5"
          />
          <span>I have read and agree to the terms and conditions above. *</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={submitting} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !termsAgreed}
            style={{ backgroundColor: primaryColor }}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Confirm & Accept"}
          </button>
        </div>
      </div>
    </div>
  )
}