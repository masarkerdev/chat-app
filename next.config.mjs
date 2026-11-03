/**
 * নিরাপত্তা হেডার
 * ব্রাউজারকে বলে দেয় এই অ্যাপ কোথা থেকে কী লোড করতে পারবে, অন্য সাইট একে লুকিয়ে
 * নিজের ভেতরে দেখাতে পারবে না, আর লিংক খোলার সময় কোনো তথ্য বাইরে যাবে না।
 */

const isDev = process.env.NODE_ENV !== 'production';

// Supabase-এর ঠিকানা (শেষের /rest/v1 বা / বাদ দিয়ে)
const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/(rest|auth)\/v1$/, '');
const supabaseWs = supabase.replace(/^http/, 'ws');

const csp = [
  "default-src 'self'",
  // Next.js আর থিমের ছোট স্ক্রিপ্ট পেইজের ভেতরেই থাকে; ডেভেলপমেন্টে eval লাগে
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // ছবি: নিজের, Supabase-এর প্রাইভেট লিংক, আর আপলোডের আগের প্রিভিউ (blob)
  `img-src 'self' blob: data: ${supabase}`.trim(),
  "font-src 'self' data:",
  // ডাটাবেস, রিয়েলটাইম (wss) আর নিজের API
  `connect-src 'self' ${supabase} ${supabaseWs}${isDev ? ' ws: http://localhost:*' : ''}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // অন্য কোনো সাইট এই অ্যাপকে iframe-এ ঢোকাতে পারবে না
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // লিংক খুললে এই অ্যাপের ঠিকানা (বা ছবির লিংক) অন্য সাইট জানতে পারবে না
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // অ্যাপ ক্যামেরা/মাইক/লোকেশন ব্যবহার করে না — তাই বন্ধ
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['web-push'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // service worker সবসময় নতুন করে লোড হবে
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
