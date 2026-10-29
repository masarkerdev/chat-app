'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { disablePush } from '@/lib/push';
import { clearLock, getLock, markHidden, setLockedState, shouldRelock, verifyPin, waitSeconds } from '@/lib/applock';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bn = (n: number) => n.toLocaleString('bn-BD');

/**
 * PIN লক থাকলে চ্যাটের উপরে লক স্ক্রিন দেখায়।
 * - অ্যাপ খুললেই লক
 * - বাইরে গিয়ে ফিরলে বাছাই করা সময় পার হলে আবার লক
 * - "সাথে সাথে" বাছলে বাইরে যাওয়ার মুহূর্তেই লক, যাতে রিসেন্ট অ্যাপের তালিকাতেও চ্যাট না দেখা যায়
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');

  useEffect(() => {
    const lockNow = () => {
      setLockedState(true);
      setState('locked');
    };
    if (getLock()) lockNow();
    else {
      setLockedState(false);
      setState('open');
    }

    const onVisibility = () => {
      const cfg = getLock();
      if (!cfg) return;
      if (document.visibilityState === 'hidden') {
        markHidden();
        if (cfg.delay === 0) lockNow();
      } else if (shouldRelock()) {
        lockNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const unlock = useCallback(() => {
    setLockedState(false);
    setState('open');
  }, []);

  return (
    <>
      <div className="lock-content" inert={state !== 'open'} aria-hidden={state !== 'open'}>
        {state !== 'checking' && children}
      </div>
      {state === 'locked' && <LockScreen onUnlock={unlock} />}
    </>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const digits = getLock()?.digits ?? 4;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(0);
  const checking = useRef(false);

  // বারবার ভুলের পর অপেক্ষার সময় গোনা
  useEffect(() => {
    setWait(waitSeconds());
    const t = setInterval(() => setWait(waitSeconds()), 1000);
    return () => clearInterval(t);
  }, []);

  const check = useCallback(
    async (value: string) => {
      if (checking.current) return;
      checking.current = true;
      const ok = await verifyPin(value);
      checking.current = false;
      if (ok) {
        onUnlock();
        return;
      }
      navigator.vibrate?.([30, 40, 30]);
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin('');
      }, 450);
      const w = waitSeconds();
      setWait(w);
      setError(w > 0 ? 'অনেকবার ভুল হয়েছে' : 'PIN মেলেনি, আবার দিন');
    },
    [onUnlock]
  );

  const press = useCallback(
    (d: string) => {
      if (checking.current || waitSeconds() > 0) return;
      setError('');
      setPin((p) => {
        if (p.length >= digits) return p;
        const next = p + d;
        if (next.length === digits) check(next);
        return next;
      });
    },
    [digits, check]
  );

  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  // কিবোর্ড থেকেও PIN দেওয়া যায়
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [press, back]);

  const forgot = async () => {
    if (
      !confirm(
        'PIN ভুলে গেলে লগআউট করে ইমেইল-পাসওয়ার্ড দিয়ে আবার ঢুকতে হবে। এই ডিভাইস থেকে লক মুছে যাবে। এগিয়ে যাবেন?'
      )
    )
      return;
    clearLock();
    await disablePush();
    await getSupabase().auth.signOut();
    location.href = '/login';
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="অ্যাপ লক">
      <div className="lock-inner">
        <p className="lock-mark">Dujone</p>
        <p className="lock-title">PIN দিয়ে খুলুন</p>

        <div className={`pin-dots ${shake ? 'is-shake' : ''}`} aria-label={`${bn(pin.length)}টি সংখ্যা দেওয়া হয়েছে`}>
          {Array.from({ length: digits }, (_, i) => (
            <i key={i} className={i < pin.length ? 'is-on' : ''} />
          ))}
        </div>

        <p className="lock-error" role="alert">
          {wait > 0 ? `অনেকবার ভুল হয়েছে। ${bn(wait)} সেকেন্ড পর আবার চেষ্টা করুন` : error}
        </p>

        <div className="keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} onClick={() => press(String(n))} disabled={wait > 0} aria-label={String(n)}>
              {BN_DIGITS[n]}
            </button>
          ))}
          <button className="key-text" onClick={forgot}>
            ভুলে গেছি
          </button>
          <button onClick={() => press('0')} disabled={wait > 0} aria-label="0">
            {BN_DIGITS[0]}
          </button>
          <button className="key-text" onClick={back} aria-label="মুছুন">
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
