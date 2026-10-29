'use client';

import { useEffect, useState } from 'react';
import {
  clearLock,
  getLock,
  isValidPin,
  LOCK_DELAYS,
  setDelay,
  setPin,
  verifyPin,
  waitSeconds,
  type LockConfig,
} from '@/lib/applock';
import { CloseIcon } from './Icons';

/** মেনু → "অ্যাপ লক": PIN চালু, বদল বা বন্ধ */
export function AppLockDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [delay, setDelayState] = useState(60);
  const [current, setCurrent] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    const c = getLock();
    setCfg(c);
    if (c) setDelayState(c.delay);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  const checkNew = () => {
    if (!isValidPin(pin1)) return '৪ থেকে ৬ সংখ্যার PIN দিন।';
    if (/^(\d)\1+$/.test(pin1) || '0123456789'.includes(pin1) || '9876543210'.includes(pin1))
      return '১১১১ বা ১২৩৪-এর মতো সহজ PIN নয়, অন্য কিছু দিন।';
    if (pin1 !== pin2) return 'দুটি PIN মেলেনি।';
    return '';
  };

  const checkCurrent = async () => {
    if (waitSeconds() > 0) return `অনেকবার ভুল হয়েছে। ${waitSeconds().toLocaleString('bn-BD')} সেকেন্ড পর চেষ্টা করুন।`;
    if (!(await verifyPin(current))) return 'বর্তমান PIN মেলেনি।';
    return '';
  };

  const turnOn = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = checkNew();
    if (err) return setError(err);
    setBusy(true);
    await setPin(pin1, delay);
    setBusy(false);
    setDone('লক চালু হয়েছে। পরের বার অ্যাপ খুললে PIN চাইবে।');
  };

  const changePin = async () => {
    setError('');
    const err = checkNew();
    if (err) return setError(err);
    setBusy(true);
    const cur = await checkCurrent();
    if (cur) {
      setBusy(false);
      return setError(cur);
    }
    await setPin(pin1, delay);
    setBusy(false);
    setDone('নতুন PIN সেট হয়েছে।');
  };

  const turnOff = async () => {
    setError('');
    setBusy(true);
    const cur = await checkCurrent();
    setBusy(false);
    if (cur) return setError(cur);
    clearLock();
    setDone('লক বন্ধ হয়েছে।');
  };

  const pinInput = (label: string, value: string, set: (v: string) => void, auto?: string) => (
    <label>
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete={auto ?? 'off'}
        pattern="\d*"
        maxLength={6}
        value={value}
        onChange={(e) => {
          setError('');
          set(digitsOnly(e.target.value));
        }}
      />
    </label>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="lock-title">অ্যাপ লক</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose} disabled={busy}>
            <CloseIcon size={20} />
          </button>
        </div>

        {done ? (
          <div className="dialog-done">
            <div className="done-check" aria-hidden>
              ✓
            </div>
            <p>{done}</p>
            <button className="primary-btn" onClick={onClose}>
              ঠিক আছে
            </button>
          </div>
        ) : (
          <form className="login-form dialog-form" onSubmit={cfg ? (e) => e.preventDefault() : turnOn}>
            <p className="muted hint lock-intro">
              {cfg
                ? 'লক চালু আছে। অ্যাপ খুললে PIN ছাড়া চ্যাট দেখা যায় না।'
                : 'PIN চালু করলে এই ফোনে অ্যাপ খুলতে প্রতিবার PIN লাগবে, অন্য কেউ ফোন হাতে পেলেও চ্যাট দেখতে পাবে না।'}
            </p>

            <div className="theme-section">
              <h3>কখন আবার লক হবে</h3>
              <div className="segmented" role="radiogroup" aria-label="কখন আবার লক হবে">
                {LOCK_DELAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    role="radio"
                    aria-checked={delay === d.value}
                    className={delay === d.value ? 'is-on' : ''}
                    onClick={() => {
                      setDelayState(d.value);
                      if (cfg) setDelay(d.value);
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {cfg && pinInput('বর্তমান PIN', current, setCurrent, 'current-password')}
            {pinInput(cfg ? 'নতুন PIN (বদলাতে চাইলে)' : 'নতুন PIN (৪-৬ সংখ্যা)', pin1, setPin1, 'new-password')}
            {pinInput('নতুন PIN আবার দিন', pin2, setPin2, 'new-password')}

            <p className="muted hint">
              PIN ভুলে গেলে লক স্ক্রিনে "ভুলে গেছি" চেপে লগআউট করে পাসওয়ার্ড দিয়ে আবার ঢুকতে পারবেন।
            </p>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            {cfg ? (
              <div className="dialog-actions">
                <button type="button" className="ghost-btn danger-text" onClick={turnOff} disabled={busy}>
                  লক বন্ধ করুন
                </button>
                <button type="button" className="primary-btn" onClick={changePin} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'PIN বদলান'}
                </button>
              </div>
            ) : (
              <button className="primary-btn" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : 'লক চালু করুন'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
