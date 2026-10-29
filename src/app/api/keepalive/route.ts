import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/keepalive
 * Vercel প্রতিদিন একবার নিজে থেকে এটি ডাকে (vercel.json → crons)।
 * Supabase-এর ফ্রি প্রজেক্ট ৭ দিন কোনো কাজ না হলে ঘুমিয়ে (pause) পড়ে —
 * প্রতিদিনের এই ছোট্ট ডাক সেটা ঠেকায়। কোনো মেসেজ বা তথ্য পড়ে না, শুধু ping()।
 *
 * Vercel-এ CRON_SECRET সেট করলে শুধু Vercel-ই এটি ডাকতে পারবে (ঐচ্ছিক)।
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 503 });

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc('ping');
  if (error) {
    console.error('keepalive failed', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, db_time: data });
}
