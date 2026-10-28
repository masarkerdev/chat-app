'use client';

import { useEffect, useState } from 'react';
import { BellIcon, CloseIcon } from './Icons';
import type { usePush } from '@/hooks/usePush';

const DISMISS_KEY = 'dujone-push-banner-dismissed';

function readDismissed() {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    // বন্ধ করলে ৭ দিন পর আবার মনে করিয়ে দেবে
    return !!v && Date.now() - Number(v) < 7 * 86_400_000;
  } catch {
    return false;
  }
}

/** নোটিফিকেশন চালু না থাকলে চ্যাটের উপরে ছোট একটা অনুরোধ */
export function PushBanner({ push }: { push: ReturnType<typeof usePush> }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const hide = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* প্রাইভেট মোডে localStorage নাও থাকতে পারে */
    }
  };

  if (dismissed || push.active || push.permission === 'denied') return null;
  if (!push.supported && !push.iosTab) return null;

  return (
    <div className="push-banner" role="region" aria-label="নোটিফিকেশন">
      <BellIcon size={20} className="push-banner-icon" />
      <p>
        {push.iosTab
          ? 'iPhone-এ নোটিফিকেশন পেতে Safari-র শেয়ার বাটন → "Add to Home Screen" করে সেখান থেকে অ্যাপ খুলুন।'
          : 'অ্যাপ বন্ধ থাকলেও নতুন মেসেজের খবর পেতে নোটিফিকেশন চালু করুন।'}
      </p>
      {!push.iosTab && (
        <button className="push-banner-btn" onClick={push.enable} disabled={push.busy}>
          চালু করুন
        </button>
      )}
      <button className="icon-btn push-banner-close" aria-label="বন্ধ করুন" onClick={hide}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
