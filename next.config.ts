import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"],
  // Security headers and the Content-Security-Policy (CSP_MODE) on every
  // route, pages and API alike. See src/lib/security-headers.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;
