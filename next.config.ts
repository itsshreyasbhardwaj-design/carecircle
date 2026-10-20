import type { NextConfig } from 'next';

const config: NextConfig = {
  // node:sqlite and unpdf must stay outside the bundler — they are server-only.
  serverExternalPackages: ['unpdf'],
  experimental: { authInterrupts: true },
  // Documents are streamed through authorised route handlers only; never from /public.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
