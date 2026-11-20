/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone so the production Docker image stays small.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
