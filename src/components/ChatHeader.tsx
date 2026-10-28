'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { BellIcon, BellOffIcon, KeyIcon, LogoutIcon, MoreIcon, PenIcon } from './Icons';
import { PasswordDialog } from './PasswordDialog';
import { formatLastSeen } from '@/lib/format';
import type { Profile } from '@/lib/types';
import type { usePush } from '@/hooks/usePush';

type Props = {
  me: Profile;
  partner: Profile | null;
  online: boolean;
  typing: boolean;
  connected: boolean;
  push: ReturnType<typeof usePush>;
  onRename: (name: string) => void;
  onLogout: () => void;
};

export function ChatHeader({ me, partner, online, typing, connected, push, onRename, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [, forceTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // "x মিনিট আগে" লেখাটা প্রতি মিনিটে আপডেট
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  let statusLine: string;
  let statusClass = 'header-status';
  if (!partner) {
    statusLine = 'অপর সদস্য এখনো যোগ দেননি';
  } else if (!connected) {
    statusLine = 'সংযোগ হচ্ছে…';
  } else if (typing) {
    statusLine = 'টাইপ করছে…';
    statusClass += ' is-live';
  } else if (online) {
    statusLine = 'অনলাইন';
    statusClass += ' is-live';
  } else {
    statusLine = formatLastSeen(partner.last_seen);
  }

  const rename = () => {
    setOpen(false);
    const name = window.prompt('আপনার নাম (অপর পক্ষ এই নামটি দেখবেন):', me.display_name);
    if (name && name.trim()) onRename(name);
  };

  const togglePush = async () => {
    setOpen(false);
    if (push.active) {
      if (confirm('এই ডিভাইসে নোটিফিকেশন বন্ধ করবেন?')) await push.disable();
    } else {
      const ok = await push.enable();
      if (ok) alert('নোটিফিকেশন চালু হয়েছে ✓ অ্যাপ বন্ধ থাকলেও নতুন মেসেজের খবর পাবেন।');
    }
  };

  return (
    <header className="chat-header">
      {/* দুজনের দুই সুতো: অপর জনের অবতারের সাথে নিজের ছোট অবতার জোড়া */}
      <div className="avatar-pair" aria-hidden={!partner}>
        {partner ? (
          <Avatar name={partner.display_name} tone="them" online={online && connected} size={42} />
        ) : (
          <span className="avatar avatar-empty" style={{ width: 42, height: 42 }} />
        )}
        <Avatar name={me.display_name} tone="me" size={26} />
      </div>

      <div className="header-text">
        <h1 className="header-name">{partner?.display_name ?? 'দুজনে'}</h1>
        <p className={statusClass} aria-live="polite">
          {statusLine}
        </p>
      </div>

      <div className="menu-wrap" ref={menuRef}>
        <button className="icon-btn on-header" aria-label="মেনু" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <MoreIcon />
        </button>
        {open && (
          <div className="menu" role="menu">
            <div className="menu-me">
              <Avatar name={me.display_name} tone="me" size={32} />
              <span>{me.display_name}</span>
            </div>
            <button role="menuitem" onClick={rename}>
              <PenIcon /> নাম পরিবর্তন
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPwOpen(true);
              }}
            >
              <KeyIcon /> পাসওয়ার্ড পরিবর্তন
            </button>
            {(push.supported || push.iosTab) && (
              <button role="menuitem" onClick={togglePush} disabled={push.busy}>
                {push.active ? (
                  <>
                    <BellOffIcon /> নোটিফিকেশন বন্ধ করুন
                  </>
                ) : (
                  <>
                    <BellIcon /> নোটিফিকেশন চালু করুন
                  </>
                )}
              </button>
            )}
            <button role="menuitem" className="danger" onClick={onLogout}>
              <LogoutIcon /> লগআউট
            </button>
          </div>
        )}
      </div>

      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </header>
  );
}
