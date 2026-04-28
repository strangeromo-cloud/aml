/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep these heavy native-ish libs as Node externals so Next.js doesn't
    // try to bundle them through Webpack on the server.
    serverComponentsExternalPackages: ["pdfjs-dist", "exceljs"],
  },
};
export default nextConfig;
