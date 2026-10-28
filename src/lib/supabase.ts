import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** ব্রাউজারে একটাই Supabase ক্লায়েন্ট ব্যবহার হবে */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL এবং NEXT_PUBLIC_SUPABASE_ANON_KEY সেট করা নেই। .env.local ফাইল দেখুন।'
    );
  }

  // ভুল করে /rest/v1/ বা শেষে / দিলে নিজেই ঠিক করে নেয়
  const base = url.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');

  client = createClient(base, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

export const IMAGE_BUCKET = 'chat-images';
export const PAGE_SIZE = 50;
