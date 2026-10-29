'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble, type Quote } from './MessageBubble';
import { ImageViewer } from './ImageViewer';
import { ArrowDownIcon } from './Icons';
import { dayKey, formatDayLabel } from '@/lib/format';
import type { Message } from '@/lib/types';

type Props = {
  messages: Message[];
  meId: string;
  hasMore: boolean;
  loadingOlder: boolean;
  typing: boolean;
  onLoadOlder: () => void;
  partnerName: string;
  quotes: Record<string, Message | null>;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onReply: (msg: Message) => void;
  onEdit: (msg: Message) => void;
  onReact: (id: string, emoji: string) => void;
};

const GROUP_GAP_MS = 5 * 60 * 1000;

export function MessageList({
  messages,
  meId,
  hasMore,
  loadingOlder,
  typing,
  partnerName,
  quotes,
  onLoadOlder,
  onDelete,
  onRetry,
  onReply,
  onEdit,
  onReact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const quoteFor = useCallback(
    (m: Message): Quote | null => {
      if (!m.reply_to) return null;
      const q = byId.get(m.reply_to) ?? quotes[m.reply_to] ?? null;
      const byMe = q ? q.sender_id === meId : false;
      return { msg: q, name: partnerName, byMe };
    },
    [byId, quotes, meId, partnerName]
  );

  // রিপ্লাইয়ের উদ্ধৃতিতে চাপলে মূল মেসেজে গিয়ে একটু ঝলক দেয়
  const jumpTo = useCallback((id: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1600);
  }, []);

  const atBottom = useRef(true);
  const prev = useRef({ first: '', last: '', height: 0, initialized: false });

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // নতুন মেসেজ / পুরোনো মেসেজ লোড হলে স্ক্রল ঠিক রাখা
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = messages[0]?.id ?? '';
    const lastMsg = messages[messages.length - 1];
    const last = lastMsg?.id ?? '';
    const p = prev.current;

    if (!p.initialized && messages.length) {
      el.scrollTop = el.scrollHeight;
      p.initialized = true;
    } else if (first !== p.first && last === p.last && p.height) {
      // উপরে পুরোনো মেসেজ যোগ হয়েছে — দেখার জায়গা স্থির রাখি
      el.scrollTop += el.scrollHeight - p.height;
    } else if (last !== p.last && lastMsg) {
      if (lastMsg.sender_id === meId || atBottom.current) {
        atBottom.current = true;
        scrollToBottom();
      } else {
        setNewCount((n) => n + 1);
      }
    }
    p.first = first;
    p.last = last;
    p.height = el.scrollHeight;
  }, [messages, meId, scrollToBottom]);

  // টাইপিং ইন্ডিকেটর দেখা দিলে নিচে থাকলে নিচেই রাখি
  useEffect(() => {
    if (typing && atBottom.current) scrollToBottom();
  }, [typing, scrollToBottom]);

  // ছবি লোড হয়ে উচ্চতা বাড়লে নিচে লেগে থাকি
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && atBottom.current) el.scrollTop = el.scrollHeight;
      if (el) prev.current.height = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // সবচেয়ে উপরে পৌঁছালে পুরোনো মেসেজ লোড
  useEffect(() => {
    const top = topRef.current;
    const root = scrollRef.current;
    if (!top || !root || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && prev.current.initialized) onLoadOlder();
      },
      { root, rootMargin: '200px 0px 0px 0px' }
    );
    io.observe(top);
    return () => io.disconnect();
  }, [hasMore, onLoadOlder]);

  const lastTop = useRef(0);
  const lastUserInput = useRef(0);
  const markUserInput = () => {
    lastUserInput.current = Date.now();
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    // শুধু ব্যবহারকারী নিজে স্ক্রল করলে "নিচে আটকে থাকা" বন্ধ হবে
    const userDriven = Date.now() - lastUserInput.current < 1200;
    if (near) atBottom.current = true;
    else if (userDriven && el.scrollTop < lastTop.current) atBottom.current = false;
    lastTop.current = el.scrollTop;
    setShowJump(!atBottom.current);
    if (atBottom.current) setNewCount(0);
  };

  const closeViewer = useCallback(() => setViewer(null), []);

  return (
    <div className="messages-wrap">
      <div
        className="messages"
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={markUserInput}
        onTouchMove={markUserInput}
        onKeyDown={markUserInput}
        onPointerDown={markUserInput}
        onClick={() => activeId && setActiveId(null)}
      >
        <div className="messages-inner" ref={innerRef}>
        <div ref={topRef} className="top-sentinel">
          {loadingOlder && <span className="spinner spinner-dark" aria-label="লোড হচ্ছে" />}
          {!hasMore && messages.length > 0 && <span className="chat-start">এখান থেকে শুরু। এই কথাগুলো শুধু আপনাদের দুজনের।</span>}
        </div>

        {messages.length === 0 && (
          <div className="empty">
            <svg className="empty-art" viewBox="0 0 160 60" aria-hidden>
              <path className="thread-them" d="M4 40 C 40 4, 70 4, 80 30 S 120 56, 156 20" />
              <path className="thread-me" d="M4 20 C 40 56, 70 56, 80 30 S 120 4, 156 40" />
            </svg>
            <p className="empty-title">প্রথম ফোঁড়টা আপনিই দিন</p>
            <p className="muted">নিচে লিখে একটা মেসেজ পাঠান।</p>
          </div>
        )}

        {messages.map((m, i) => {
          const before = messages[i - 1];
          const newDay = !before || dayKey(before.created_at) !== dayKey(m.created_at);
          const firstInGroup =
            newDay ||
            before.sender_id !== m.sender_id ||
            new Date(m.created_at).getTime() - new Date(before.created_at).getTime() > GROUP_GAP_MS;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day-sep">
                  <span>{formatDayLabel(m.created_at)}</span>
                </div>
              )}
              <MessageBubble
                msg={m}
                mine={m.sender_id === meId}
                meId={meId}
                firstInGroup={firstInGroup}
                active={activeId === m.id}
                highlighted={highlightId === m.id}
                quote={quoteFor(m)}
                onActivate={setActiveId}
                onOpenImage={setViewer}
                onDelete={onDelete}
                onRetry={onRetry}
                onReply={onReply}
                onEdit={onEdit}
                onReact={onReact}
                onJumpTo={jumpTo}
              />
            </Fragment>
          );
        })}

        {typing && (
          <div className="row row-theirs row-first">
            <div className="bubble bubble-theirs has-tail typing-bubble" aria-label="টাইপ করছে">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
     </div>

      {showJump && (
        <button
          className="jump"
          aria-label="সবশেষ মেসেজে যান"
          onClick={() => {
            atBottom.current = true;
            scrollToBottom(true);
            setNewCount(0);
          }}
        >
          {newCount > 0 && <span className="jump-count">{newCount.toLocaleString('bn-BD')}</span>}
          <ArrowDownIcon />
        </button>
      )}

      {viewer && <ImageViewer url={viewer} onClose={closeViewer} />}
    </div>
  );
}
