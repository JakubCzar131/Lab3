/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    serverActions: {
      // Uploady zdjęć mogą być cięższe niż domyślny limit 1MB.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
