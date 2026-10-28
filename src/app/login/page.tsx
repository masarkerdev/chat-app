'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

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
    <main className="login">
      <div className="login-card">
        <svg className="login-threads" viewBox="0 0 240 70" aria-hidden>
          <path className="thread-them" d="M4 52 C 60 4, 100 4, 120 35 S 180 66, 236 18" />
          <path className="thread-me" d="M4 18 C 60 66, 100 66, 120 35 S 180 4, 236 52" />
        </svg>
        <h1 className="wordmark">দুজনে</h1>
        <p className="login-sub">দুটি সুতো, একটি কাঁথা। শুধু আপনাদের দুজনের কথা।</p>

        <form onSubmit={submit} className="login-form">
          <label>
            <span>ইমেইল</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span>পাসওয়ার্ড</span>
            <div className="pass-field">
              <input
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="pass-toggle" onClick={() => setShowPass((v) => !v)}>
                {showPass ? 'লুকান' : 'দেখান'}
              </button>
            </div>
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'লগইন'}
          </button>
        </form>
      </div>
    </main>
  );
}
