/**
 * থিম — দুই সুতোর রঙ আর আলো (লাইট/ডার্ক)।
 * পছন্দটা এই ডিভাইসেই (localStorage) থাকে; দুজনে আলাদা আলাদা রঙ রাখতে পারেন।
 * সব রঙ CSS-এর দুটি ভেরিয়েবল (--me, --them) থেকে তৈরি হয়, বাকিটা globals.css মিশিয়ে নেয়।
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export type ThemeSettings = {
  mode: ThemeMode;
  /** প্রিসেটের id, অথবা 'custom' */
  preset: string;
  me: string;
  them: string;
};

export type Preset = { id: string; name: string; me: string; them: string };

export const PRESETS: Preset[] = [
  { id: 'kantha', name: 'নকশিকাঁথা', me: '#23336b', them: '#a8323f' },
  { id: 'dhan', name: 'ধানক্ষেত', me: '#2f5d34', them: '#c98a1a' },
  { id: 'jamdani', name: 'জামদানি', me: '#5a2a6e', them: '#c2547a' },
  { id: 'mati', name: 'মাটির হাঁড়ি', me: '#6b3a22', them: '#d0782d' },
  { id: 'nodi', name: 'নদী', me: '#11615e', them: '#e07a5f' },
  { id: 'josna', name: 'জোছনা', me: '#2b2d42', them: '#c9a227' },
];

export const DEFAULT_THEME: ThemeSettings = {
  mode: 'system',
  preset: PRESETS[0].id,
  me: PRESETS[0].me,
  them: PRESETS[0].them,
};

export const THEME_KEY = 'dujone-theme';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** রঙটা হালকা হলে তার ওপর কালো লেখা, গাঢ় হলে সাদা লেখা */
export function textOn(hex: string) {
  return luminance(hex) > 0.4 ? '#14161d' : '#f5f6fa';
}

/** সাদা পটভূমিতে লেখা হিসেবে পড়া যায় এমন রঙ (হালকা রঙ হলে গাঢ় করে নেয়) */
export function inkOf(hex: string) {
  const lum = luminance(hex);
  if (lum < 0.18) return hex;
  const k = lum > 0.5 ? 0.42 : 0.62; // যত হালকা, তত বেশি গাঢ় করা
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** সব হিসাব করা রঙ — CSS ভেরিয়েবল হিসেবে বসে */
function derived(t: ThemeSettings) {
  const light = textOn(t.me) !== '#f5f6fa';
  return {
    '--me': t.me,
    '--them': t.them,
    '--on-me': textOn(t.me),
    '--on-them': textOn(t.them),
    // লাইট মোডে লেখার রঙ; ডার্ক মোড globals.css-এ নিজের হালকা রূপ নেয়
    '--me-ink-l': inkOf(t.me),
    '--them-ink-l': inkOf(t.them),
    // হালকা বাবলের ওপর হলুদ গিঁট দেখা যায় না, তখন গাঢ় খয়েরি
    '--seen': light ? '#8a4b00' : '#f2c14e',
  };
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULT_THEME;
    const t = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      mode: t.mode === 'light' || t.mode === 'dark' ? t.mode : 'system',
      preset: typeof t.preset === 'string' ? t.preset : DEFAULT_THEME.preset,
      me: t.me && HEX_RE.test(t.me) ? t.me : DEFAULT_THEME.me,
      them: t.them && HEX_RE.test(t.them) ? t.them : DEFAULT_THEME.them,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(t: ThemeSettings) {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ ...t, vars: derived(t) }));
  } catch {
    /* প্রাইভেট মোডে সেভ নাও হতে পারে — তবু এই সেশনে কাজ করবে */
  }
}

/** পেইজে থিম বসায় (সাথে সাথে দেখা যায়) */
export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement;
  if (t.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t.mode);
  for (const [k, v] of Object.entries(derived(t))) root.style.setProperty(k, v);
  syncStatusBar();
}

/** যেকোনো CSS রঙকে (oklab ইত্যাদি) সাধারণ rgb-তে রূপান্তর — স্ট্যাটাস বার সব ফোনে বুঝতে পারে */
function toRgb(color: string) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return color;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return color;
  }
}

/** ফোনের স্ট্যাটাস বারের রঙ অ্যাপের পটভূমির সাথে মেলায় */
export function syncStatusBar() {
  requestAnimationFrame(() => {
    const bg = toRgb(getComputedStyle(document.body).backgroundColor);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  });
}

/**
 * পেইজ আঁকার আগেই থিম বসানোর ছোট স্ক্রিপ্ট (layout-এর <head>-এ)।
 * এতে খোলার সময় এক ঝলক ভুল রঙ দেখা যায় না।
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem('${THEME_KEY}')||'null');if(!t)return;var r=document.documentElement,h=/^#[0-9a-f]{6}$/i;if(t.mode==='light'||t.mode==='dark')r.setAttribute('data-theme',t.mode);var v=t.vars||{};for(var k in v){if(/^--[a-z-]+$/.test(k)&&h.test(v[k]))r.style.setProperty(k,v[k]);}}catch(e){}})();`;
