'use client';

/**
 * অ্যাপ লক (PIN) — শুধু এই ডিভাইসে।
 * PIN কখনো সরাসরি সেভ হয় না; লবণ (salt) মিশিয়ে PBKDF2 দিয়ে হ্যাশ করে রাখা হয়।
 * ভুলে গেলে: লগআউট করে পাসওয়ার্ড দিয়ে আবার ঢুকলে লক মুছে যায়।
 */

const KEY = 'dujone-lock';
const FAIL_KEY = 'dujone-lock-fails';
const HIDDEN_KEY = 'dujone-hidden-at';

export type LockConfig = {
  salt: string;
  hash: string;
  /** কত সেকেন্ড অ্যাপের বাইরে থাকলে আবার লক হবে (০ = সাথে সাথে) */
  delay: number;
  digits: number;
};

export const LOCK_DELAYS: { value: number; label: string }[] = [
  { value: 0, label: 'সাথে সাথে' },
  { value: 60, label: '১ মিনিট পর' },
  { value: 300, label: '৫ মিনিট পর' },
];

// ---------------------------------------------------------------- লক অবস্থা (পুরো অ্যাপ জানে)
let locked = false;
export const isLocked = () => locked;
export function setLockedState(v: boolean) {
  locked = v;
  // খোলার পর চ্যাট যেন "দেখেছে" চিহ্ন দেয়
  if (!v) window.dispatchEvent(new Event('dujone-unlocked'));
}

// ---------------------------------------------------------------- সংরক্ষণ
export function getLock(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as LockConfig;
    return c.salt && c.hash ? c : null;
  } catch {
    return null;
  }
}

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 150_000, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

export function isValidPin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}

export async function setPin(pin: string, delay: number) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const cfg: LockConfig = { salt, hash: await hashPin(pin, salt), delay, digits: pin.length };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  clearFails();
}

export function setDelay(delay: number) {
  const c = getLock();
  if (c) localStorage.setItem(KEY, JSON.stringify({ ...c, delay }));
}

export function clearLock() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(FAIL_KEY);
    sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* কিছু করার নেই */
  }
  locked = false;
}

// ---------------------------------------------------------------- যাচাই + বারবার ভুলে অপেক্ষা
type Fails = { count: number; until: number };

function getFails(): Fails {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) || '') as Fails;
  } catch {
    return { count: 0, until: 0 };
  }
}
function clearFails() {
  try {
    localStorage.removeItem(FAIL_KEY);
  } catch {}
}

/** আর কত সেকেন্ড অপেক্ষা করতে হবে (০ = এখনই চেষ্টা করা যাবে) */
export function waitSeconds() {
  return Math.max(0, Math.ceil((getFails().until - Date.now()) / 1000));
}

/** সঠিক হলে true; ৫ বার ভুল হলে ৩০ সেকেন্ড, তারপর প্রতিবার দ্বিগুণ অপেক্ষা */
export async function verifyPin(pin: string): Promise<boolean> {
  const c = getLock();
  if (!c) return true;
  if (waitSeconds() > 0) return false;
  const ok = (await hashPin(pin, c.salt)) === c.hash;
  if (ok) {
    clearFails();
    return true;
  }
  const f = getFails();
  const count = f.count + 1;
  const until = count >= 5 ? Date.now() + 30_000 * 2 ** Math.min(count - 5, 5) : 0;
  try {
    localStorage.setItem(FAIL_KEY, JSON.stringify({ count, until }));
  } catch {}
  return false;
}

// ---------------------------------------------------------------- অ্যাপ থেকে বের হওয়ার সময় মনে রাখা
export function markHidden() {
  try {
    sessionStorage.setItem(HIDDEN_KEY, String(Date.now()));
  } catch {}
}

/** ফিরে আসার পর আবার লক করা দরকার কিনা */
export function shouldRelock() {
  const c = getLock();
  if (!c) return false;
  try {
    const at = Number(sessionStorage.getItem(HIDDEN_KEY) || 0);
    return !at || Date.now() - at >= c.delay * 1000;
  } catch {
    return true;
  }
}
