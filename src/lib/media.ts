'use client';

import { getSupabase, IMAGE_BUCKET } from './supabase';

/** ছবি / ফাইল / ভয়েস — একই বাকেটে থাকে */
export type MediaKind = 'image' | 'file' | 'voice';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VOICE_MS = 5 * 60 * 1000;

export function mediaKindOf(m: { image_path: string | null; media_kind?: string | null }): MediaKind | null {
  if (!m.image_path) return null;
  if (m.media_kind === 'file' || m.media_kind === 'voice') return m.media_kind;
  return 'image';
}

const bn = (n: number, digits = 0) =>
  n.toLocaleString('bn-BD', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** ১.৪ MB, ৩২০ KB */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bn(bytes)} B`;
  if (bytes < 1024 * 1024) return `${bn(Math.round(bytes / 1024))} KB`;
  return `${bn(bytes / (1024 * 1024), 1)} MB`;
}

/** ০:০৮, ১২:০৫ */
export function formatDuration(ms: number | null | undefined) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${bn(m)}:${s.toLocaleString('bn-BD', { minimumIntegerDigits: 2, useGrouping: false })}`;
}

/** ফাইলের ধরন — বাক্সে দেখানোর জন্য (PDF, DOCX…) */
export function fileBadge(name: string | null | undefined) {
  const ext = name?.split('.').pop();
  if (!ext || ext === name || ext.length > 5) return 'FILE';
  return ext.toUpperCase();
}

/** ফাইলের নাম থেকে পথে সমস্যা করতে পারে এমন অক্ষর সরানো (নাম ডাটাবেসে আসলটাই থাকে) */
export function cleanFileName(name: string) {
  const n = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  return (n || 'ফাইল').slice(0, 200);
}

/** ভয়েস রেকর্ডের ফরম্যাট — Android/Chrome-এ webm, iPhone-এ mp4 */
export function pickVoiceMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function baseMime(type: string) {
  return type.split(';')[0].trim().toLowerCase();
}

export function voiceExt(type: string) {
  const t = baseMime(type);
  if (t.includes('mp4') || t.includes('aac')) return 'm4a';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('mpeg')) return 'mp3';
  return 'webm';
}

/** ফাইল নামানো — ৬০ সেকেন্ডের লিংক, আসল নামে "download" হিসেবে */
export async function downloadFile(path: string, name: string) {
  const { data, error } = await getSupabase()
    .storage.from(IMAGE_BUCKET)
    .createSignedUrl(path, 60, { download: name });
  if (error || !data) throw new Error(error?.message ?? 'লিংক পাওয়া যায়নি');
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener noreferrer';
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** মেসেজের id থেকে সবসময় একই রকম "ঢেউ" — ভয়েসের দেখানোর জন্য */
export function waveFor(id: string, bars = 32) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    // মাঝখানে একটু উঁচু, দুই প্রান্তে নিচু — কথার মতো
    const env = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / bars);
    out.push(Math.max(0.18, Math.min(1, env * (0.35 + 0.65 * r))));
  }
  return out;
}
