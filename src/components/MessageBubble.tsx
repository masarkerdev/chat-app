'use client';

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { formatTime, isEmojiOnly, splitLinks } from '@/lib/format';
import type { Message } from '@/lib/types';
import { AlertIcon, ArrowDownIcon, CopyIcon, RetryIcon, TrashIcon } from './Icons';

type Props = {
  msg: Message;
  mine: boolean;
  firstInGroup: boolean;
  active: boolean;
  onActivate: (id: string | null) => void;
  onOpenImage: (url: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
};

/**
 * মেসেজের অবস্থা — দুই ফোঁটা সুতোর গিঁট:
 *   ফাঁপা বৃত্ত = পাঠানো হচ্ছে, একটি গিঁট = পৌঁছেছে, দুটি জোড়া গিঁট = দেখেছে
 */
function Status({ msg }: { msg: Message }) {
  if (msg.failed) return <AlertIcon className="st st-failed" size={15} />;
  if (msg.pending)
    return <span className="knots knots-pending" role="img" aria-label="পাঠানো হচ্ছে"><i /></span>;
  if (msg.seen_at)
    return <span className="knots knots-seen" role="img" aria-label="দেখেছে"><i /><i /></span>;
  return <span className="knots" role="img" aria-label="পৌঁছেছে"><i /></span>;
}

function BubbleImage({ msg, onOpen }: { msg: Message; onOpen: (url: string) => void }) {
  const url = useSignedUrl(msg.image_path, msg.localUrl);
  return (
    <button className="bubble-img" onClick={() => url && onOpen(url)} aria-label="ছবি বড় করে দেখুন">
      {url ? <img src={url} alt="পাঠানো ছবি" loading="lazy" decoding="async" /> : <span className="img-skeleton" />}
      {msg.pending && <span className="img-uploading"><span className="spinner" /></span>}
    </button>
  );
}

function MessageBubbleBase({ msg, mine, firstInGroup, active, onActivate, onOpenImage, onDelete, onRetry }: Props) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [menuUp, setMenuUp] = useState(false);

  // নিচে জায়গা কম থাকলে মেনু উপরের দিকে খুলবে
  useLayoutEffect(() => {
    if (!active || !bubbleRef.current) return;
    const box = bubbleRef.current.getBoundingClientRect();
    const scroller = bubbleRef.current.closest('.messages');
    const limit = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    setMenuUp(box.bottom + 150 > limit);
  }, [active]);

  const text = msg.content ?? '';
  const emojiOnly = !msg.image_path && isEmojiOnly(text);

  const startPress = () => {
    moved.current = false;
    pressTimer.current = setTimeout(() => {
      if (!moved.current) {
        navigator.vibrate?.(15);
        onActivate(msg.id);
      }
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const copy = async () => {
    onActivate(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* পুরোনো ব্রাউজার */
    }
  };

  const remove = () => {
    onActivate(null);
    if (confirm('মেসেজটি দুজনের কাছ থেকেই মুছে যাবে। মুছবেন?')) onDelete(msg.id);
  };

  return (
    <div className={`row ${mine ? 'row-mine' : 'row-theirs'} ${firstInGroup ? 'row-first' : ''}`}>
      <div
        ref={bubbleRef}
        className={[
          'bubble',
          mine ? 'bubble-mine' : 'bubble-theirs',
          firstInGroup ? 'has-tail' : '',
          msg.image_path ? 'is-image' : '',
          emojiOnly ? 'is-emoji' : '',
          active ? 'is-active' : '',
          msg.failed ? 'is-failed' : '',
        ].join(' ')}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerMove={() => (moved.current = true)}
        onContextMenu={(e) => {
          e.preventDefault();
          onActivate(msg.id);
        }}
      >
        {msg.image_path ? (
          <BubbleImage msg={msg} onOpen={onOpenImage} />
        ) : (
          <p className="bubble-text">
            {splitLinks(text).map((part, i) =>
              part.href ? (
                <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
                  {part.text}
                </a>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
            <span className="meta-spacer" aria-hidden />
          </p>
        )}

        <span className="meta">
          <time dateTime={msg.created_at}>{formatTime(msg.created_at)}</time>
          {mine && <Status msg={msg} />}
        </span>

        <button
          className="bubble-caret"
          aria-label="অপশন"
          onClick={(e) => {
            e.stopPropagation();
            onActivate(active ? null : msg.id);
          }}
        >
          <ArrowDownIcon size={16} />
        </button>

        {active && (
          <div className={`bubble-menu ${mine ? 'menu-left' : 'menu-right'} ${menuUp ? 'menu-up' : ''}`} role="menu" onPointerDown={(e) => e.stopPropagation()}>
            {msg.failed && (
              <button role="menuitem" onClick={() => { onActivate(null); onRetry(msg.id); }}>
                <RetryIcon /> আবার পাঠান
              </button>
            )}
            {!msg.image_path && (
              <button role="menuitem" onClick={copy}>
                <CopyIcon /> কপি
              </button>
            )}
            {mine && (
              <button role="menuitem" className="danger" onClick={remove}>
                <TrashIcon /> মুছে ফেলুন
              </button>
            )}
            {!mine && msg.image_path && (
              <button role="menuitem" onClick={() => onActivate(null)}>বন্ধ করুন</button>
            )}
          </div>
        )}
      </div>

      {msg.failed && (
        <button className="retry-chip" onClick={() => onRetry(msg.id)}>
          পাঠানো যায়নি · আবার চেষ্টা
        </button>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleBase);
