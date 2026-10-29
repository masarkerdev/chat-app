'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { currentEndpoint } from '@/lib/push';
import { describeDevice, formatAgo, type DeviceKind, type DeviceSession } from '@/lib/devices';
import { formatFull } from '@/lib/format';
import { explainError } from '@/hooks/useChat';
import { BellIcon, CloseIcon } from './Icons';

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (kind === 'computer')
    return (
      <svg {...common}>
        <rect x="3" y="4.5" width="18" height="12" rx="2" />
        <path d="M2 19.5h20" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x={kind === 'tablet' ? 4 : 6.5} y="2.5" width={kind === 'tablet' ? 16 : 11} height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

/** মেনু → "লগইন করা ডিভাইস": কোথায় কোথায় লগইন আছে, আর সেখান থেকে লগআউট */
export function DevicesDialog({ onKick, onClose }: { onKick: (ids: string[]) => void; onClose: () => void }) {
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('list_my_sessions');
    if (error) {
      console.error('ডিভাইস তালিকা আনা যায়নি', error);
      setError(explainError(error));
      setList([]);
      return;
    }
    setList((data ?? []) as DeviceSession[]);
  }, []);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  const done = (count: number) => {
    setNotice(
      `${count > 1 ? `${count.toLocaleString('bn-BD')}টি ডিভাইস` : 'ডিভাইসটি'} থেকে লগআউট হয়েছে। কেউ পাসওয়ার্ড জেনে ফেলেছে মনে হলে মেনু থেকে পাসওয়ার্ডও বদলে নিন।`
    );
    load();
  };

  const revokeOne = async (s: DeviceSession) => {
    const { name, browser } = describeDevice(s.user_agent);
    if (!confirm(`"${name}${browser ? ` · ${browser}` : ''}" থেকে লগআউট করবেন?`)) return;
    setBusy(s.session_id);
    setError('');
    const { error } = await getSupabase().rpc('revoke_session', { p_session_id: s.session_id });
    setBusy(null);
    if (error) {
      console.error('লগআউট ব্যর্থ', error);
      return setError(`লগআউট করা যায়নি। ${explainError(error)}`);
    }
    onKick([s.session_id]);
    done(1);
  };

  const revokeOthers = async () => {
    if (!confirm('এই ডিভাইস ছাড়া বাকি সব ডিভাইস থেকে লগআউট করবেন?')) return;
    setBusy('all');
    setError('');
    const { data, error } = await getSupabase().rpc('revoke_other_sessions', {
      p_keep_endpoint: await currentEndpoint(),
    });
    setBusy(null);
    if (error) {
      console.error('লগআউট ব্যর্থ', error);
      return setError(`লগআউট করা যায়নি। ${explainError(error)}`);
    }
    const ids = (data ?? []) as string[];
    onKick(ids);
    done(ids.length);
  };

  const others = (list ?? []).filter((s) => !s.is_current);

  return (
    <div className="dialog-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="dialog devices-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="devices-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="devices-title">লগইন করা ডিভাইস</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose} disabled={!!busy}>
            <CloseIcon size={20} />
          </button>
        </div>

        <p className="muted hint devices-intro">
          আপনার অ্যাকাউন্ট যেসব ফোন ও কম্পিউটারে খোলা আছে। চেনেন না এমন কিছু দেখলে লগআউট করে দিন।
        </p>

        {list === null ? (
          <div className="devices-loading">
            <span className="spinner spinner-dark" aria-label="লোড হচ্ছে" />
          </div>
        ) : (
          <ul className="devices">
            {list.map((s) => {
              const d = describeDevice(s.user_agent);
              return (
                <li key={s.session_id} className={`device ${s.is_current ? 'is-current' : ''}`}>
                  <span className="device-icon">
                    <DeviceIcon kind={d.kind} />
                  </span>
                  <div className="device-body">
                    <span className="device-name">
                      {d.name}
                      {d.browser && <span className="device-browser"> · {d.browser}</span>}
                      {s.has_push && <BellIcon size={14} className="device-bell" />}
                    </span>
                    <span className="device-meta">
                      {s.is_current ? 'এই ডিভাইস' : `শেষ সক্রিয় ${formatAgo(s.last_active)}`}
                      {' · '}লগইন {formatFull(s.created_at)}
                    </span>
                    {s.ip && <span className="device-ip">IP {s.ip}</span>}
                  </div>
                  {!s.is_current && (
                    <button className="device-out" onClick={() => revokeOne(s)} disabled={!!busy}>
                      {busy === s.session_id ? <span className="spinner spinner-dark" /> : 'লগআউট'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {notice && (
          <p className="devices-notice" role="status">
            ✓ {notice}
          </p>
        )}
        {error && (
          <p className="form-error devices-error" role="alert">
            {error}
          </p>
        )}

        {others.length > 0 && (
          <button className="ghost-btn danger-text devices-all" onClick={revokeOthers} disabled={!!busy}>
            {busy === 'all' ? <span className="spinner spinner-dark" /> : 'অন্য সব ডিভাইস থেকে লগআউট'}
          </button>
        )}
        {list !== null && others.length === 0 && !error && (
          <p className="muted hint devices-only">এই মুহূর্তে শুধু এই ডিভাইসেই লগইন আছে।</p>
        )}
      </div>
    </div>
  );
}
