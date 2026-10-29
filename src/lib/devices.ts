/** লগইন করা ডিভাইসের তথ্য — নাম চেনা, সেশন id, "কতক্ষণ আগে" */

export type DeviceSession = {
  session_id: string;
  created_at: string;
  last_active: string;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
  has_push: boolean;
};

export type DeviceKind = 'phone' | 'tablet' | 'computer';

/** User-Agent দেখে "Android ফোন · Chrome" ধরনের নাম */
export function describeDevice(ua: string | null): { kind: DeviceKind; name: string; browser: string } {
  const u = ua ?? '';
  let kind: DeviceKind = 'computer';
  let name = 'অজানা ডিভাইস';

  if (/iPad/i.test(u) || (/Macintosh/i.test(u) && /Mobile/i.test(u))) {
    kind = 'tablet';
    name = 'iPad';
  } else if (/iPhone|iPod/i.test(u)) {
    kind = 'phone';
    name = 'iPhone';
  } else if (/Android/i.test(u)) {
    kind = /Mobile/i.test(u) ? 'phone' : 'tablet';
    name = kind === 'phone' ? 'Android ফোন' : 'Android ট্যাবলেট';
  } else if (/Windows/i.test(u)) {
    name = 'Windows কম্পিউটার';
  } else if (/Macintosh|Mac OS X/i.test(u)) {
    name = 'Mac কম্পিউটার';
  } else if (/CrOS/i.test(u)) {
    name = 'Chromebook';
  } else if (/Linux/i.test(u)) {
    name = 'Linux কম্পিউটার';
  }

  let browser = '';
  if (/SamsungBrowser/i.test(u)) browser = 'Samsung Internet';
  else if (/Edg\//i.test(u)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(u)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(u)) browser = 'Firefox';
  else if (/Chrome|CriOS/i.test(u)) browser = 'Chrome';
  else if (/Safari/i.test(u)) browser = 'Safari';

  return { kind, name, browser };
}

/** Supabase access token (JWT) থেকে এই লগইনের session_id */
export function sessionIdFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
    return (JSON.parse(json) as { session_id?: string }).session_id ?? null;
  } catch {
    return null;
  }
}

/** "এইমাত্র", "৫ মিনিট আগে", "২ ঘণ্টা আগে", "৩ দিন আগে" */
export function formatAgo(iso: string) {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const bn = (n: number) => Math.floor(n).toLocaleString('bn-BD');
  if (sec < 90) return 'এইমাত্র';
  if (sec < 3600) return `${bn(sec / 60)} মিনিট আগে`;
  if (sec < 86400) return `${bn(sec / 3600)} ঘণ্টা আগে`;
  if (sec < 86400 * 30) return `${bn(sec / 86400)} দিন আগে`;
  return new Date(iso).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
}
