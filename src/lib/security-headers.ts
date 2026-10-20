// Security headers for every response, applied by headers() in
// next.config.ts. Kept free of imports so next.config.ts and
// scripts/check-headers.ts can load it on their own.

// "report-only" sends the full Content-Security-Policy as
// Content-Security-Policy-Report-Only: browsers report violations to
// /api/csp-report and block nothing. "enforce" sends it as
// Content-Security-Policy. Flip this once the reports are clean.
export type CspMode = "report-only" | "enforce"
export const CSP_MODE = "report-only" as CspMode

export const CSP_REPORT_PATH = "/api/csp-report"
// The Reporting-Endpoints group the policy's report-to directive names
export const CSP_REPORT_GROUP = "csp-endpoint"

export interface HeaderEnv {
  NODE_ENV?: string
  AWS_S3_BUCKET_NAME?: string
  AWS_REGION?: string
}

// Uploaded images (company and vendor logos, attachment thumbnails) load
// straight from the uploads bucket, https://<bucket>.s3.<region>.amazonaws.com
// (src/lib/uploads.ts). Without the bucket settings at build time any S3
// host is allowed instead.
export function uploadsImageOrigin(env: HeaderEnv): string {
  const bucket = env.AWS_S3_BUCKET_NAME?.trim()
  const region = env.AWS_REGION?.trim()
  if (bucket && region && /^[a-z0-9.-]+$/.test(bucket) && /^[a-z0-9-]+$/.test(region)) {
    return `https://${bucket}.s3.${region}.amazonaws.com`
  }
  return "https://*.amazonaws.com"
}

// The policy, from an inventory of everything the app loads in the
// browser. Every source is here for a reason:
// - default-src 'self': anything not listed below comes from this app only
// - script-src 'unsafe-inline': Next.js bootstrap and hydration scripts and
//   next-themes' theme script are inline; a static policy can't use nonces.
//   'unsafe-eval' only in development, where React uses eval for error
//   stacks.
// - style-src 'unsafe-inline': inline style attributes (HeroUI, the portal
//   and company branding colors) and the portal's <style> tag
// - img-src data: blob: and the uploads bucket: logos and thumbnails from
//   S3, file previews before upload (blob:), and inline images (data:)
// - font-src 'self': next/font serves Geist and Parisienne from this app
// - connect-src 'self': the browser only calls this app's /api routes
// - object-src 'none', base-uri 'self': no plugins, no <base> hijacking
// - form-action 'self': every form submits with JavaScript to this app;
//   Microsoft sign in is reached by navigation, not a form post
// - frame-ancestors 'none': the app is never shown inside a frame
export function buildCsp(env: HeaderEnv): string {
  const isDev = env.NODE_ENV === "development"
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", uploadsImageOrigin(env)]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [CSP_REPORT_GROUP]],
  ]
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ")
}

export interface HeaderEntry {
  key: string
  value: string
}

// Headers enforced on every route now, plus the CSP in CSP_MODE. Frame
// protection is enforced both ways: X-Frame-Options for older browsers and
// a one directive Content-Security-Policy (frame-ancestors 'none') while
// the full policy is only reported. Nothing in the app frames its own pages
// or PDFs (PDFs download as attachments). HSTS is not set here: Vercel
// sends its own; check a custom domain's responses before adding one.
export function securityHeaders(env: HeaderEnv, mode: CspMode = CSP_MODE): HeaderEntry[] {
  const csp = buildCsp(env)
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
  ]
  if (mode === "enforce") {
    headers.push({ key: "Content-Security-Policy", value: csp })
  } else {
    headers.push({ key: "Content-Security-Policy", value: "frame-ancestors 'none'" })
    headers.push({ key: "Content-Security-Policy-Report-Only", value: csp })
  }
  return headers
}
