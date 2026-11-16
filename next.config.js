/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14 only runs src/instrumentation.ts (tracing + the LFL sync schedule) with this on.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
