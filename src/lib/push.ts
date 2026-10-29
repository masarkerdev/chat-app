'use client';

import { getSupabase } from './supabase';

/**
 * Web Push — ক্লায়েন্ট অংশ
 * - enablePush():   অনুমতি চেয়ে এই ডিভাইসকে সাবস্ক্রাইব করে ও ডাটাবেসে সেভ করে
 * - syncPush():     অ্যাপ খুললেই সাবস্ক্রিপশন সতেজ রাখে (key বদলালে/মেয়াদ গেলে নতুন করে)
 * - disablePush():  লগআউট বা বন্ধ করলে এই ডিভাইস থেকে মুছে দেয়
 * - notifyPartner(): মেসেজ পাঠানোর পর সার্ভারকে বলে অপর পক্ষকে push পাঠাতে
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const NOTIF_TAG = 'dujone-message';

let active = false;
const listeners = new Set<() => void>();

function setActive(v: boolean) {
  active = v;
  listeners.forEach((fn) => fn());
}

/** এই ডিভাইসে push চালু আছে কিনা */
export function isPushActive() {
  return active;
}

export function onPushChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pushConfigured() {
  return VAPID_PUBLIC_KEY.length > 0;
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone/iPad-এ হোম স্ক্রিনে ইনস্টল না করলে push কাজ করে না */
export function isIosBrowserTab() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export function permissionState(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // পুরোনো ব্রাউজার জানায় না — ধরে নিই ঠিক আছে
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  // ডেভেলপমেন্টে service worker আগে রেজিস্টার হয় না, তাই এখানে করি
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await getSupabase().rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

async function ensureSubscription(): Promise<PushSubscription> {
  const reg = await getRegistration();
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await saveSubscription(sub);
  return sub;
}

/** "নোটিফিকেশন চালু করুন" চাপলে — এটি অবশ্যই ক্লিকের ভেতর থেকে ডাকতে হবে */
export async function enablePush(): Promise<{ ok: boolean; message?: string }> {
  if (!pushSupported()) {
    return { ok: false, message: 'এই ব্রাউজারে push নোটিফিকেশন সাপোর্ট নেই।' };
  }
  if (isIosBrowserTab()) {
    return {
      ok: false,
      message: 'iPhone-এ নোটিফিকেশন পেতে আগে Safari-র শেয়ার বাটন → "Add to Home Screen" করে অ্যাপটি খুলুন।',
    };
  }
  if (!pushConfigured()) {
    return { ok: false, message: 'সার্ভারে VAPID key সেট করা নেই (README দেখুন)।' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      message:
        permission === 'denied'
          ? 'নোটিফিকেশন ব্লক করা আছে। ব্রাউজারের সাইট সেটিংস থেকে Allow করুন।'
          : 'অনুমতি দেওয়া হয়নি।',
    };
  }

  try {
    await ensureSubscription();
    setActive(true);
    return { ok: true };
  } catch (e) {
    console.error('push subscribe failed', e);
    setActive(false);
    return { ok: false, message: 'নোটিফিকেশন চালু করা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।' };
  }
}

/** অ্যাপ খুললে চুপচাপ চালানো হয় — অনুমতি আগে দেওয়া থাকলেই কাজ করে */
export async function syncPush() {
  if (!pushSupported() || !pushConfigured() || Notification.permission !== 'granted') {
    setActive(false);
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    // ব্যবহারকারী নিজে বন্ধ করে থাকলে (সাবস্ক্রিপশন নেই) আবার চালু করি না
    const existing = await reg?.pushManager.getSubscription();
    if (!existing) {
      setActive(false);
      return;
    }
    await ensureSubscription();
    setActive(true);
  } catch (e) {
    console.warn('push sync failed', e);
    setActive(false);
  }
}

/** এই ডিভাইসের push ঠিকানা (থাকলে) */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** সার্ভারে না জানিয়ে শুধু এই ব্রাউজারে push বন্ধ (লগআউট হয়ে গেলে) */
export async function unsubscribeLocal() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* কিছু করার নেই */
  }
  setActive(false);
}

export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await getSupabase().rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn('push disable failed', e);
  }
  setActive(false);
}

/** মেসেজ সার্ভারে পৌঁছানোর পর ডাকা হয়; একই মেসেজে দুবার ডাকলেও একবারই push যায় */
export async function notifyPartner(messageId: string, kind: 'message' | 'reaction' | 'nudge' = 'message') {
  if (!pushConfigured()) return;
  try {
    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session) return;
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ messageId, kind }),
      keepalive: true, // অ্যাপ বন্ধ করে দিলেও রিকোয়েস্টটি শেষ হবে
    });
  } catch {
    /* নোটিফিকেশন না গেলেও মেসেজ ঠিকই পৌঁছেছে */
  }
}

/** চ্যাট খুললে আগের নোটিফিকেশনগুলো সরিয়ে দেয় */
export async function clearNotifications() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    // মেসেজ ও রিঅ্যাকশন — দুই ধরনের নোটিফিকেশনই সরাই
    for (const tag of [NOTIF_TAG, 'dujone-reaction', 'dujone-nudge']) {
      const list = (await reg?.getNotifications({ tag })) ?? [];
      list.forEach((n) => n.close());
    }
  } catch {
    /* কিছু ব্রাউজারে getNotifications নেই */
  }
}
