'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { CloseIcon } from './Icons';

const MIN_LEN = 8;

function bnError(message: string, code?: string) {
  const m = message.toLowerCase();
  if (code === 'same_password' || m.includes('different from the old')) return 'নতুন পাসওয়ার্ড আগেরটার মতো হতে পারবে না।';
  if (code === 'weak_password' || m.includes('weak') || m.includes('at least')) return 'পাসওয়ার্ডটি খুব দুর্বল। আরো লম্বা ও মিশ্র অক্ষরের পাসওয়ার্ড দিন।';
  if (code === 'reauthentication_needed' || m.includes('reauthentication')) return 'নিরাপত্তার জন্য একবার লগআউট করে আবার লগইন করুন, তারপর চেষ্টা করুন।';
  if (m.includes('rate limit') || m.includes('too many')) return 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  if (m.includes('fetch') || m.includes('network')) return 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।';
  return message;
}

/** দুর্বলতা যাচাই: দৈর্ঘ্য + অক্ষরের ধরন */
function strength(pw: string) {
  let score = 0;
  if (pw.length >= MIN_LEN) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|pass)/i.test(pw)) score = Math.min(score, 1);
  if (score <= 1) return { level: 1, label: 'দুর্বল' };
  if (score <= 3) return { level: 2, label: 'মোটামুটি' };
  return { level: 3, label: 'শক্ত' };
}

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const s = strength(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (next.length < MIN_LEN) return setError(`নতুন পাসওয়ার্ড কমপক্ষে ${MIN_LEN.toLocaleString('bn-BD')} অক্ষরের হতে হবে।`);
    if (s.level === 1) return setError('পাসওয়ার্ডটি খুব সহজ (যেমন 12345678)। অক্ষর, সংখ্যা ও চিহ্ন মিশিয়ে দিন।');
    if (next !== confirm) return setError('নতুন পাসওয়ার্ড দুটি মেলেনি।');
    if (next === current) return setError('নতুন পাসওয়ার্ড আগেরটার মতো হতে পারবে না।');

    setBusy(true);
    const sb = getSupabase();

    // ১. বর্তমান পাসওয়ার্ড সঠিক কিনা যাচাই (কেউ খোলা ফোন হাতে পেলেও যেন বদলাতে না পারে)
    const { data: userData } = await sb.auth.getUser();
    const email = userData.user?.email;
    if (!email) {
      setBusy(false);
      return setError('আবার লগইন করে চেষ্টা করুন।');
    }
    const { error: authErr } = await sb.auth.signInWithPassword({ email, password: current });
    if (authErr) {
      setBusy(false);
      return setError(
        authErr.message.toLowerCase().includes('invalid login')
          ? 'বর্তমান পাসওয়ার্ড ভুল।'
          : bnError(authErr.message, authErr.code)
      );
    }

    // ২. নতুন পাসওয়ার্ড সেট
    const { error: updErr } = await sb.auth.updateUser({ password: next });
    setBusy(false);
    if (updErr) return setError(bnError(updErr.message, updErr.code));

    setDone(true);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="pw-title">পাসওয়ার্ড পরিবর্তন</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose} disabled={busy}>
            <CloseIcon size={20} />
          </button>
        </div>

        {done ? (
          <div className="dialog-done">
            <div className="done-check" aria-hidden>
              ✓
            </div>
            <p>পাসওয়ার্ড পরিবর্তন হয়েছে।</p>
            <p className="muted">পরের বার নতুন পাসওয়ার্ড দিয়ে লগইন করবেন।</p>
            <button className="primary-btn" onClick={onClose}>
              ঠিক আছে
            </button>
          </div>
        ) : (
          <form className="login-form dialog-form" onSubmit={submit}>
            <label>
              <span>বর্তমান পাসওয়ার্ড</span>
              <input
                ref={firstRef}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>

            <label>
              <span>নতুন পাসওয়ার্ড</span>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={MIN_LEN}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              {next && (
                <span className={`pw-meter level-${s.level}`}>
                  <span className="pw-bar">
                    <i />
                    <i />
                    <i />
                  </span>
                  {s.label}
                </span>
              )}
            </label>

            <label>
              <span>নতুন পাসওয়ার্ড আবার লিখুন</span>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              <span>পাসওয়ার্ড দেখান</span>
            </label>

            <p className="muted hint">কমপক্ষে ৮ অক্ষর। বড়-ছোট হাতের অক্ষর, সংখ্যা ও চিহ্ন মেশালে ভালো।</p>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button className="primary-btn" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : 'পাসওয়ার্ড পরিবর্তন করুন'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
