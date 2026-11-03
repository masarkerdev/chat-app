'use client';

import { useEffect, useState } from 'react';
import { DISAPPEAR_OPTIONS } from '@/lib/format';
import { CloseIcon, TimerIcon } from './Icons';

/** মেনু → "মেসেজ নিজে মুছে যাওয়া": নতুন মেসেজ কতক্ষণ পর মুছে যাবে (দুজনের জন্যই) */
export function DisappearDialog({
  current,
  partnerName,
  onSave,
  onClose,
}: {
  current: number;
  partnerName: string;
  onSave: (seconds: number) => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (seconds: number) => {
    if (seconds === current) return;
    setBusy(seconds);
    setError('');
    const err = await onSave(seconds);
    setBusy(null);
    if (err) setError(`বদলানো যায়নি। ${err}`);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disappear-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="disappear-title">মেসেজ নিজে মুছে যাওয়া</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="disappear-hero" aria-hidden>
          <TimerIcon size={34} />
        </div>
        <p className="muted hint disappear-intro">
          চালু করলে এখন থেকে পাঠানো নতুন মেসেজ ও ছবি বাছাই করা সময় পর দুজনের কাছ থেকেই নিজে মুছে যাবে। আগের মেসেজে কোনো
          প্রভাব পড়বে না। বদলালে {partnerName}-ও জানতে পারবেন।
        </p>

        <div className="choice-list" role="radiogroup" aria-label="কতক্ষণ পর মুছবে">
          {DISAPPEAR_OPTIONS.map((o) => (
            <button
              key={o.seconds}
              role="radio"
              aria-checked={current === o.seconds}
              className={`choice choice-row ${current === o.seconds ? 'is-on' : ''}`}
              onClick={() => pick(o.seconds)}
              disabled={busy !== null}
            >
              <span className="choice-dot" aria-hidden />
              <span className="choice-body">
                <strong>{o.seconds ? `${o.label} পর` : 'বন্ধ'}</strong>
              </span>
              {busy === o.seconds && <span className="spinner spinner-dark" />}
            </button>
          ))}
        </div>

        <p className="muted hint disappear-note">
          মনে রাখবেন: অপর জন মুছে যাওয়ার আগে স্ক্রিনশট নিতে বা লেখা কপি করতে পারেন।
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
