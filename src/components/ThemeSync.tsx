'use client';

import { useEffect } from 'react';
import { applyTheme, loadTheme, syncStatusBar } from '@/lib/theme';

/** অ্যাপ খুললে থিম বসায়; ফোনের লাইট/ডার্ক বদলালে স্ট্যাটাস বারের রঙও বদলায় */
export function ThemeSync() {
  useEffect(() => {
    applyTheme(loadTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', syncStatusBar);
    return () => mq.removeEventListener('change', syncStatusBar);
  }, []);
  return null;
}
