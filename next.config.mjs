/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backend = process.env.AML_BACKEND_URL;
    return backend ? [{ source: "/api/aml/:path*", destination: `${backend}/api/aml/:path*` }] : [];
  },
};
export default nextConfig;
