'use client';

import { useEffect, useState } from 'react';
import {
  applyTheme,
  DEFAULT_THEME,
  loadTheme,
  PRESETS,
  saveTheme,
  type ThemeMode,
  type ThemeSettings,
} from '@/lib/theme';
import { CloseIcon } from './Icons';

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'ফোনের মতো' },
  { id: 'light', label: 'লাইট' },
  { id: 'dark', label: 'ডার্ক' },
];

export function ThemeDialog({ partnerName, onClose }: { partnerName: string; onClose: () => void }) {
  const [t, setT] = useState<ThemeSettings>(DEFAULT_THEME);

  useEffect(() => {
    setT(loadTheme());
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // প্রতিটি বদল সাথে সাথে পুরো অ্যাপে দেখা যায় ও সেভ হয়
  const update = (patch: Partial<ThemeSettings>) => {
    const next = { ...t, ...patch };
    setT(next);
    applyTheme(next);
    saveTheme(next);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog theme-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="theme-title">থিম ও রঙ</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>

        {/* ছোট নমুনা — বদল সাথে সাথে এখানে দেখা যায় */}
        <div className="theme-preview" aria-hidden>
          <span className="tp-bubble tp-theirs">কেমন আছো?</span>
          <span className="tp-bubble tp-mine">ভালো আছি, তুমি?</span>
        </div>

        <section className="theme-section">
          <h3>আলো</h3>
          <div className="segmented" role="radiogroup" aria-label="আলো">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={t.mode === m.id}
                className={t.mode === m.id ? 'is-on' : ''}
                onClick={() => update({ mode: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>

        <section className="theme-section">
          <h3>রঙের জোড়া</h3>
          <div className="swatches" role="radiogroup" aria-label="রঙের জোড়া">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={t.preset === p.id}
                className={`swatch ${t.preset === p.id ? 'is-on' : ''}`}
                onClick={() => update({ preset: p.id, me: p.me, them: p.them })}
              >
                <span className="swatch-dots" aria-hidden>
                  <i style={{ background: p.them }} />
                  <i style={{ background: p.me }} />
                </span>
                <span className="swatch-name">{p.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="theme-section">
          <h3>নিজে রঙ বাছুন</h3>
          <label className="color-row">
            <span>আপনার মেসেজ</span>
            <input
              type="color"
              value={t.me}
              onChange={(e) => update({ preset: 'custom', me: e.target.value })}
            />
          </label>
          <label className="color-row">
            <span>{partnerName}-এর মেসেজ</span>
            <input
              type="color"
              value={t.them}
              onChange={(e) => update({ preset: 'custom', them: e.target.value })}
            />
          </label>
        </section>

        <p className="muted hint theme-note">
          এই রঙ শুধু আপনার এই ডিভাইসে বদলাবে। {partnerName} নিজের ফোনে নিজের পছন্দের রঙ রাখতে পারবেন।
        </p>

        <div className="dialog-actions">
          <button className="ghost-btn" onClick={() => update(DEFAULT_THEME)}>
            আগের রঙে ফেরান
          </button>
          <button className="primary-btn" onClick={onClose}>
            ঠিক আছে
          </button>
        </div>
      </div>
    </div>
  );
}
