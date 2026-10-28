'use client';

import { useEffect, useState } from 'react';
import { getSupabase, IMAGE_BUCKET } from '@/lib/supabase';

const TTL_SECONDS = 60 * 60; // ১ ঘণ্টা
const cache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchSignedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;

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

/** প্রাইভেট বাকেটের ছবির জন্য সাময়িক (signed) লিংক */
export function useSignedUrl(path: string | null, fallback?: string) {
  const [url, setUrl] = useState<string | null>(() => {
    if (fallback) return fallback;
    return path ? cache.get(path)?.url ?? null : null;
  });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    fetchSignedUrl(path).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return url ?? fallback ?? null;
}
