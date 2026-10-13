import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/csp";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    const csp = contentSecurityPolicy(apiUrl, process.env.NODE_ENV !== "production");
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};

export default nextConfig;
