'use client';

import { useEffect, useState } from 'react';
import { snippet } from '@/lib/format';
import type { Message, Pin } from '@/lib/types';
import { PinIcon } from './Icons';

type Props = {
  pins: Pin[];
  /** তালিকায় থাকা মেসেজ (এডিট হলে নতুন লেখাটা দেখাতে) */
  byId: Map<string, Message>;
  onJump: (m: { id: string; created_at: string }) => void;
};

/**
 * হেডারের নিচে পিন করা মেসেজ।
 * একাধিক থাকলে চাপলে সেটাতে যায়, আর বার পরের (পুরোনো) পিনে সরে যায়।
 */
export function PinBar({ pins, byId, onJump }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= pins.length) setIndex(0);
  }, [pins.length, index]);

  if (!pins.length) return null;
  const pin = pins[Math.min(index, pins.length - 1)];
  const msg = byId.get(pin.message_id) ?? pin.message;

  return (
    <button
      className="pin-bar"
      onClick={() => {
        if (msg) onJump({ id: pin.message_id, created_at: msg.created_at });
        if (pins.length > 1) setIndex((i) => (i + 1) % pins.length);
      }}
      aria-label="পিন করা মেসেজে যান"
    >
      {pins.length > 1 && (
        <span className="pin-ticks" aria-hidden>
          {pins.slice(0, 6).map((p, i) => (
            <i key={p.message_id} className={i === index ? 'is-on' : ''} />
          ))}
        </span>
      )}
      <PinIcon size={18} className="pin-bar-icon" />
      <span className="pin-bar-body">
        <span className="pin-bar-title">
          পিন করা মেসেজ
          {pins.length > 1 && ` ${(index + 1).toLocaleString('bn-BD')}/${pins.length.toLocaleString('bn-BD')}`}
        </span>
        <span className="pin-bar-text">{msg ? snippet(msg, 80) : 'মেসেজটি পাওয়া যাচ্ছে না'}</span>
      </span>
    </button>
  );
}
