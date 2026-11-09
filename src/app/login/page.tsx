'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@/components/Icons';

/** দুই সুতো দুই দিক থেকে এসে মাঝখানে গিঁট বাঁধে */
const THREAD_ME = 'M-12 196 C 40 196, 58 132, 104 140 S 150 184, 180 150';
const THREAD_THEM = 'M372 52 C 318 52, 300 124, 252 118 S 206 112, 180 150';

function bnError(message: string) {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'ইমেইল বা পাসওয়ার্ড ভুল।';
  if (m.includes('email not confirmed')) return 'ইমেইল এখনো কনফার্ম করা হয়নি।';
  if (m.includes('rate limit') || m.includes('too many')) return 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।';
  if (m.includes('fetch') || m.includes('network')) return 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।';
  if (m.includes('invalid path') || m.includes('invalid api key') || m.includes('no api key'))
    return 'সার্ভার সেটিং ভুল: .env.local-এ NEXT_PUBLIC_SUPABASE_URL শুধু https://xxxx.supabase.co হবে (শেষে /rest/v1 থাকবে না) এবং key ঠিক আছে কিনা দেখুন।';
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** অন্য ডিভাইস থেকে লগআউট করে দেওয়া হলে কারণ দেখাই */
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    setRevoked(new URLSearchParams(location.search).get('reason') === 'revoked');
  }, []);

  useEffect(() => {
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace('/chat');
      });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(bnError(error.message));
      setBusy(false);
      return;
    }
    router.replace('/chat');
  };

  return (
    <main className="lg">
      <section className="lg-hero" aria-label="Dujone">
        <svg className="lg-art" viewBox="0 0 360 220" preserveAspectRatio="xMidYMid meet" aria-hidden>
          <defs>
            <mask id="lg-draw-me" maskUnits="userSpaceOnUse">
              <path className="lg-draw lg-draw-me" pathLength={1} d={THREAD_ME} />
            </mask>
            <mask id="lg-draw-them" maskUnits="userSpaceOnUse">
              <path className="lg-draw lg-draw-them" pathLength={1} d={THREAD_THEM} />
            </mask>
          </defs>
          <path className="lg-thread lg-thread-me" d={THREAD_ME} mask="url(#lg-draw-me)" />
          <path className="lg-thread lg-thread-them" d={THREAD_THEM} mask="url(#lg-draw-them)" />
          <circle className="lg-knot" cx="180" cy="150" r="6" />
        </svg>
        <div className="lg-brand">
          <h1 className="lg-mark">Dujone</h1>
          <p className="lg-tagline">দুটি সুতো, একটি কাঁথা।</p>
        </div>
      </section>

      <section className="lg-sheet">
        <div className="lg-panel">
          <h2 className="lg-title">আবার স্বাগতম</h2>
          <p className="lg-sub">ইমেইল আর পাসওয়ার্ড দিয়ে চ্যাটে ঢুকুন</p>

          {revoked && (
            <p className="lg-notice" role="status">
              অন্য একটি ডিভাইস থেকে আপনাকে এখানে লগআউট করা হয়েছে। চাইলে আবার লগইন করুন।
            </p>
          )}

          <form onSubmit={submit} className="lg-form" noValidate={false}>
            <label className="lg-label" htmlFor="lg-email">
              ইমেইল
            </label>
            <div className="lg-field">
              <MailIcon className="lg-icon" />
              <input
                id="lg-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <label className="lg-label" htmlFor="lg-pass">
              পাসওয়ার্ড
            </label>
            <div className="lg-field">
              <LockIcon className="lg-icon" />
              <input
                id="lg-pass"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="lg-eye"
                aria-label={showPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান'}
                aria-pressed={showPass}
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
              </button>
            </div>

            {error && (
              <p className="lg-error" role="alert">
                {error}
              </p>
            )}

            <button className="lg-submit" type="submit" disabled={busy}>
              {busy ? <span className="spinner" aria-label="লগইন হচ্ছে" /> : 'লগইন করুন'}
            </button>
          </form>

          <p className="lg-foot">
            <LockIcon size={14} />
            এই চ্যাটে শুধু দুজন। নতুন অ্যাকাউন্ট খোলা যায় না।
          </p>
        </div>
      </section>
    </main>
  );
}
