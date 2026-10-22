import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.VOICE_CONNECTIVITY_TEST_ENABLED === "true" ? ".next-livekit-test" : process.env.E2E_ISOLATED_AUTH === "true" ? ".next-e2e" : ".next",
};
export default nextConfig;
