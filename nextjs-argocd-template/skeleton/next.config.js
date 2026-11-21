/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone so the production Docker image stays small.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Trust the proxy/load balancer in front of the Service.
  compress: true,
};

module.exports = nextConfig;
