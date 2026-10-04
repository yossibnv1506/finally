import type { NextConfig } from "next";

// Production: static export to `out/`, served by FastAPI on the same origin.
// Development (`npm run dev`): proxy /api/* to a locally running backend.
const isDev = process.env.NODE_ENV === "development";
const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
      },
    }
  : {
      output: "export",
      images: { unoptimized: true },
      trailingSlash: false,
    };

export default nextConfig;
