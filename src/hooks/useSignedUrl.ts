'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase, IMAGE_BUCKET } from '@/lib/supabase';

/**
 * প্রাইভেট বাকেটের ছবির জন্য সাময়িক (signed) লিংক।
 * লিংকের মেয়াদ মাত্র ৫ মিনিট — কেউ কপি করে বাইরে দিলেও অল্প সময়ে অকেজো হয়ে যায়।
 * মেয়াদ ফুরালে অ্যাপ নিজে থেকেই নতুন লিংক নেয়।
 */
const TTL_SECONDS = 5 * 60;
/** মেয়াদ শেষের এতটা আগেই পুরোনো লিংক বাদ দিয়ে নতুন নেয় */
const SAFETY_MS = 45_000;

const cache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string | null>>();

/** নতুন (বা এখনো তাজা) লিংক — force দিলে সবসময় নতুন */
export async function getSignedUrl(path: string, force = false): Promise<string | null> {
  const hit = cache.get(path);
  if (!force && hit && hit.expires > Date.now() + SAFETY_MS) return hit.url;

  const running = inflight.get(path);
  if (running) return running;

  const p = (async () => {
    const { data, error } = await getSupabase().storage.from(IMAGE_BUCKET).createSignedUrl(path, TTL_SECONDS);
    inflight.delete(path);
    if (error || !data) return null;
    cache.set(path, { url: data.signedUrl, expires: Date.now() + TTL_SECONDS * 1000 });
    return data.signedUrl;
  })();
  inflight.set(path, p);
  return p;
}

export function useSignedUrl(path: string | null, fallback?: string) {
  const [url, setUrl] = useState<string | null>(() => {
    if (fallback) return fallback;
    const hit = path ? cache.get(path) : null;
    return hit && hit.expires > Date.now() + SAFETY_MS ? hit.url : null;
  });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    getSignedUrl(path).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  /** ছবি লোড ব্যর্থ হলে (লিংকের মেয়াদ ফুরিয়ে গেলে) নতুন লিংক নেয় */
  const refresh = useCallback(async () => {
    if (!path) return;
    const u = await getSignedUrl(path, true);
    if (u) setUrl(u);
  }, [path]);

  return { url: url ?? fallback ?? null, refresh };
}
