/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@multiwa/core", "@multiwa/database"],
  // TypeScript IS enforced during `next build`: the admin `tsc --noEmit` CI gate keeps
  // the app type-clean, and builds now run in CI (consistent env), so there is no
  // silent-type-error footgun. ESLint stays off during build for now (the admin's
  // Next-lint isn't gated yet — a separate follow-up).
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // INTERNAL_API_URL: used for server-side proxy (Docker internal network)
    // NEXT_PUBLIC_API_URL: used for client-side requests (browser access)
    // In Docker: INTERNAL_API_URL=http://api:3333, NEXT_PUBLIC_API_URL=http://localhost:3333
    // In local dev: both default to http://localhost:3333
    const apiUrl =
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3333";
    return [
      {
        // Frontend calls /api/v1/... which gets proxied to API backend
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
