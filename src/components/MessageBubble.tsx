'use client';

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { formatTime, isEmojiOnly, snippet, splitLinks } from '@/lib/format';
import { QUICK_REACTIONS, type Message } from '@/lib/types';
import { AlertIcon, ArrowDownIcon, CopyIcon, ReplyIcon, RetryIcon, TrashIcon } from './Icons';

export type Quote = {
  /** মূল মেসেজ; null = পাওয়া যায়নি / মুছে গেছে */
  msg: Message | null;
  /** মূল মেসেজ কে লিখেছিল */
  name: string;
  byMe: boolean;
};

type Props = {
  msg: Message;
  mine: boolean;
  meId: string;
  firstInGroup: boolean;
  active: boolean;
  highlighted: boolean;
  quote: Quote | null;
  onActivate: (id: string | null) => void;
  onOpenImage: (url: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onReply: (msg: Message) => void;
  onReact: (id: string, emoji: string) => void;
  onJumpTo: (id: string) => void;
};

const SWIPE_TRIGGER = 56;
const SWIPE_MAX = 80;

/**
 * মেসেজের অবস্থা — সুতোর গিঁট:
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

function MessageBubbleBase({
  msg,
  mine,
  meId,
  firstInGroup,
  active,
  highlighted,
  quote,
  onActivate,
  onOpenImage,
  onDelete,
  onRetry,
  onReply,
  onReact,
  onJumpTo,
}: Props) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const swiping = useRef(false);
  const swipeDx = useRef(0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const [menuUp, setMenuUp] = useState(false);

  const sent = !msg.pending && !msg.failed;
  const myReaction = msg.reactions?.find((r) => r.user_id === meId)?.emoji ?? null;

  // নিচে জায়গা কম থাকলে মেনু উপরের দিকে খুলবে
  useLayoutEffect(() => {
    if (!active || !bubbleRef.current) return;
    const box = bubbleRef.current.getBoundingClientRect();
    const scroller = bubbleRef.current.closest('.messages');
    const limit = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    setMenuUp(box.bottom + 240 > limit);
  }, [active]);

  const text = msg.content ?? '';
  const emojiOnly = !msg.image_path && !msg.reply_to && isEmojiOnly(text);

  // ------------------------------------------------ লং-প্রেস + সোয়াইপ-টু-রিপ্লাই
  const setSwipe = (dx: number, animate = false) => {
    const b = bubbleRef.current;
    const h = hintRef.current;
    if (b) {
      b.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
      b.style.transform = dx ? `translateX(${dx}px)` : '';
    }
    if (h) {
      h.style.opacity = String(Math.min(dx / SWIPE_TRIGGER, 1));
      h.classList.toggle('is-ready', dx >= SWIPE_TRIGGER);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    pressTimer.current = setTimeout(() => {
      if (!moved.current) {
        navigator.vibrate?.(15);
        onActivate(msg.id);
      }
    }, 450);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved.current = true;
      if (pressTimer.current) clearTimeout(pressTimer.current);
    }
    // ডান দিকে টানলে রিপ্লাই (টাচস্ক্রিনে)
    if (!swiping.current && sent && e.pointerType !== 'mouse' && dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiping.current = true;
      try {
        bubbleRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* কিছু ব্রাউজারে capture না হলেও সোয়াইপ চলবে */
      }
      // রিপ্লাই চিহ্নটা বাবলের আসল বাম কিনারায় বসাই
      if (hintRef.current && bubbleRef.current) hintRef.current.style.left = `${bubbleRef.current.offsetLeft + 4}px`;
    }
    if (swiping.current) {
      swipeDx.current = Math.max(0, Math.min(dx, SWIPE_MAX));
      setSwipe(swipeDx.current);
    }
  };

  const endPointer = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (swiping.current) {
      if (swipeDx.current >= SWIPE_TRIGGER) {
        navigator.vibrate?.(10);
        onReply(msg);
      }
      setSwipe(0, true);
    }
    swiping.current = false;
    swipeDx.current = 0;
    start.current = null;
  };

  // ------------------------------------------------ মেনুর কাজ
  const close = () => onActivate(null);

  const copy = async () => {
    close();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* পুরোনো ব্রাউজার */
    }
  };

  const remove = () => {
    close();
    if (confirm('মেসেজটি দুজনের কাছ থেকেই মুছে যাবে। মুছবেন?')) onDelete(msg.id);
  };

  // একই ইমোজি দুজনে দিলে একসাথে "২" দেখাবে
  const grouped = (msg.reactions ?? []).reduce<{ emoji: string; count: number; mine: boolean }[]>((acc, r) => {
    const g = acc.find((x) => x.emoji === r.emoji);
    if (g) {
      g.count++;
      g.mine ||= r.user_id === meId;
    } else acc.push({ emoji: r.emoji, count: 1, mine: r.user_id === meId });
    return acc;
  }, []);

  return (
    <div
      data-mid={msg.id}
      className={[
        'row',
        mine ? 'row-mine' : 'row-theirs',
        firstInGroup ? 'row-first' : '',
        grouped.length ? 'has-reactions' : '',
        highlighted ? 'is-highlight' : '',
      ].join(' ')}
    >
      <div className="bubble-wrap">
        <span className="swipe-hint" ref={hintRef} aria-hidden>
          <ReplyIcon size={18} />
        </span>

        <div
          ref={bubbleRef}
          className={[
            'bubble',
            mine ? 'bubble-mine' : 'bubble-theirs',
            msg.image_path ? 'is-image' : '',
            emojiOnly ? 'is-emoji' : '',
            active ? 'is-active' : '',
            msg.failed ? 'is-failed' : '',
          ].join(' ')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={() => !swiping.current && pressTimer.current && clearTimeout(pressTimer.current)}
          onDoubleClick={(e) => {
            // ডাবল-ট্যাপ = ❤️
            if (!sent || msg.image_path || (e.target as HTMLElement).closest('a, button')) return;
            window.getSelection()?.removeAllRanges();
            onReact(msg.id, '❤️');
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onActivate(msg.id);
          }}
        >
          {quote && (
            <button
              className={`quote ${quote.byMe ? 'quote-me' : 'quote-them'}`}
              onClick={(e) => {
                e.stopPropagation();
                if (quote.msg) onJumpTo(quote.msg.id);
              }}
              aria-label="মূল মেসেজে যান"
            >
              <span className="quote-name">{quote.byMe ? 'আপনি' : quote.name}</span>
              <span className="quote-text">{quote.msg ? snippet(quote.msg) : 'মূল মেসেজটি আর নেই'}</span>
            </button>
          )}

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
            <div
              className={`bubble-menu ${mine ? 'menu-left' : 'menu-right'} ${menuUp ? 'menu-up' : ''}`}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {sent && (
                <div className="react-bar" role="group" aria-label="রিঅ্যাকশন দিন">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      className={myReaction === emoji ? 'is-picked' : ''}
                      aria-pressed={myReaction === emoji}
                      onClick={() => {
                        close();
                        onReact(msg.id, emoji);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {sent && (
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    onReply(msg);
                  }}
                >
                  <ReplyIcon /> রিপ্লাই
                </button>
              )}
              {msg.failed && (
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    onRetry(msg.id);
                  }}
                >
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
            </div>
          )}
        </div>

        {grouped.length > 0 && (
          <div className="reactions">
            {grouped.map((g) => (
              <button
                key={g.emoji}
                className={`reaction ${g.mine ? 'is-mine' : ''}`}
                onClick={() => onReact(msg.id, g.emoji)}
                aria-label={g.mine ? `${g.emoji} রিঅ্যাকশন সরান` : `${g.emoji} রিঅ্যাকশন দিন`}
              >
                <span className="reaction-emoji">{g.emoji}</span>
                {g.count > 1 && <span className="reaction-count">{g.count.toLocaleString('bn-BD')}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {msg.failed && (
        <button className="retry-chip" onClick={() => onRetry(msg.id)}>
          পাঠানো যায়নি, আবার চেষ্টা করুন
        </button>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleBase);
