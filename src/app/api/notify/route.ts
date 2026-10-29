import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

/**
 * POST /api/notify   { messageId }
 * Authorization: Bearer <ইউজারের Supabase access token>
 *
 * প্রেরক মেসেজ পাঠানোর পর এটি ডাকে। ডাটাবেসের claim_push() ফাংশন যাচাই করে যে
 * - ডাকছেন মেসেজের প্রেরক নিজেই
 * - এই মেসেজের নোটিফিকেশন আগে যায়নি
 * তারপর অপর পক্ষের সব ডিভাইসে এনক্রিপ্টেড push পাঠানো হয়।
 * কোনো service_role key লাগে না — ইউজারের নিজের টোকেন দিয়েই কাজ হয়।
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Target = {
  sub_endpoint: string;
  sub_p256dh: string;
  sub_auth: string;
  sender_name: string;
  body_text: string | null;
  has_image: boolean;
  /** শুধু রিঅ্যাকশনের ক্ষেত্রে */
  emoji?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let vapidReady = false;
function setupVapid() {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

function previewText(t: Target) {
  // NOTIFY_PREVIEW=false দিলে লক স্ক্রিনে মেসেজের লেখা দেখাবে না
  if (process.env.NOTIFY_PREVIEW === 'false') return 'নতুন মেসেজ';
  const text = t.body_text?.trim();
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  return t.has_image ? '📷 ছবি' : 'নতুন মেসেজ';
}

const json = (status: number, body: unknown) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!setupVapid()) return json(503, { error: 'push not configured' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return json(503, { error: 'supabase not configured' });

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'missing token' });

  let messageId: unknown;
  let kind: unknown;
  try {
    ({ messageId, kind } = await req.json());
  } catch {
    return json(400, { error: 'bad json' });
  }
  if (typeof messageId !== 'string' || !UUID_RE.test(messageId)) {
    return json(400, { error: 'bad messageId' });
  }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // kind = 'reaction': অপর জনের মেসেজে দেওয়া রিঅ্যাকশন; 'nudge': "মনে পড়ছে"
  const isReaction = kind === 'reaction';
  const isNudge = kind === 'nudge';
  const { data, error } = isNudge
    ? await sb.rpc('claim_nudge_push', { p_nudge_id: messageId })
    : await sb.rpc(isReaction ? 'claim_reaction_push' : 'claim_push', { p_message_id: messageId });
  if (error) return json(403, { error: error.message });

  const targets = (data ?? []) as Target[];
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    targets.map(async (t) => {
      const payload = JSON.stringify(
        isNudge
          ? { type: 'nudge', title: t.sender_name, body: 'আপনাকে মনে করছে 💞', url: '/chat', messageId }
          : isReaction
          ? {
              type: 'reaction',
              title: t.sender_name,
              body:
                process.env.NOTIFY_PREVIEW === 'false'
                  ? `আপনার মেসেজে ${t.emoji} দিয়েছেন`
                  : `${t.emoji} দিয়েছেন: "${previewText(t)}"`,
              url: '/chat',
              messageId,
            }
          : { type: 'message', title: t.sender_name, body: previewText(t), url: '/chat', messageId }
      );
      try {
        await webpush.sendNotification(
          { endpoint: t.sub_endpoint, keys: { p256dh: t.sub_p256dh, auth: t.sub_auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 = ডিভাইসটি আর সাবস্ক্রাইবড নেই (অ্যাপ মুছে ফেলা, অনুমতি বাতিল ইত্যাদি)
        if (status === 404 || status === 410) dead.push(t.sub_endpoint);
        else console.error('push failed', status, (e as Error).message);
      }
    })
  );

  if (dead.length) await sb.rpc('remove_push_subscriptions', { p_endpoints: dead });

  return json(200, { sent, removed: dead.length });
}
