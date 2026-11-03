'use client';

import { useEffect, useState } from 'react';
import { CloseIcon } from './Icons';

type Scope = 'me' | 'all';

/** মেনু → "পুরো চ্যাট মুছুন": শুধু আমার কাছ থেকে, নাকি দুজনের কাছ থেকেই */
export function ClearChatDialog({
  partnerName,
  onClear,
  onClose,
}: {
  partnerName: string;
  onClear: (scope: Scope) => Promise<string | null>;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>('me');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const run = async () => {
    setBusy(true);
    setError('');
    const err = await onClear(scope);
    setBusy(false);
    if (err) return setError(`মোছা যায়নি। ${err}`);
    setDone(scope === 'me' ? 'চ্যাট আপনার কাছ থেকে মুছে গেছে।' : 'চ্যাট দুজনের কাছ থেকেই মুছে গেছে।');
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="clear-title">পুরো চ্যাট মুছুন</h2>
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
          <div className="dialog-form clear-form">
            <div className="choice-list" role="radiogroup" aria-label="কার কাছ থেকে মুছবেন">
              <button
                role="radio"
                aria-checked={scope === 'me'}
                className={`choice ${scope === 'me' ? 'is-on' : ''}`}
                onClick={() => {
                  setScope('me');
                  setUnderstood(false);
                }}
              >
                <span className="choice-dot" aria-hidden />
                <span className="choice-body">
                  <strong>শুধু আমার কাছ থেকে</strong>
                  <span>এখন পর্যন্ত সব মেসেজ আপনার এই অ্যাকাউন্ট থেকে সরে যাবে। {partnerName}-এর কাছে সব আগের মতোই থাকবে।</span>
                </span>
              </button>
              <button
                role="radio"
                aria-checked={scope === 'all'}
                className={`choice ${scope === 'all' ? 'is-on' : ''}`}
                onClick={() => setScope('all')}
              >
                <span className="choice-dot" aria-hidden />
                <span className="choice-body">
                  <strong>দুজনের কাছ থেকেই</strong>
                  <span>
                    সব মেসেজ, ছবি, রিঅ্যাকশন আর পিন সার্ভার থেকে চিরতরে মুছে যাবে। {partnerName}-এর ফোন থেকেও চলে যাবে।
                  </span>
                </span>
              </button>
            </div>

            {scope === 'all' && (
              <label className="check-row understood">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                <span>আমি বুঝেছি, এগুলো আর কোনোভাবেই ফেরত আনা যাবে না</span>
              </label>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="dialog-actions">
              <button className="ghost-btn" onClick={onClose} disabled={busy}>
                বাতিল
              </button>
              <button
                className="primary-btn danger-btn"
                onClick={run}
                disabled={busy || (scope === 'all' && !understood)}
              >
                {busy ? <span className="spinner" /> : 'মুছে ফেলুন'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
