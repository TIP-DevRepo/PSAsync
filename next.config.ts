import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"],
  // The image optimizer (/_next/image) only serves the app icon, the one
  // file next/image is used for (sidebar and Updates page). Without this it
  // fetches any path on this app, so every other url gets a 400. Using
  // next/image for another local file means adding its path here; a remote
  // image needs remotePatterns, which stays unset.
  images: {
    localPatterns: [{ pathname: "/icon.png", search: "" }],
  },
  // Security headers and the Content-Security-Policy (CSP_MODE) on every
  // route, pages and API alike. See src/lib/security-headers.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;
