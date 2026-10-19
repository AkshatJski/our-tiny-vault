/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Free-tier guard: keep the client bundle small. Nothing heavy gets bundled
  // because every budget-sensitive library is dynamically imported.
  experimental: {
    optimizePackageImports: ['framer-motion'],
  },
  images: {
    // We serve photos from Supabase Storage (private bucket -> signed URLs).
    // No Vercel Image Optimization traffic for third-party hosts is needed,
    // which keeps us inside the Hobby image-optimization allowance.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/**' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
    formats: ['image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // a time capsule photo never changes
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
