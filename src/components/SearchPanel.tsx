'use client';

import { useEffect, useRef, useState } from 'react';
import { formatFull } from '@/lib/format';
import type { Message } from '@/lib/types';
import { CloseIcon, SearchIcon } from './Icons';

type Props = {
  meId: string;
  partnerName: string;
  onSearch: (q: string) => Promise<Message[] | null>;
  onPick: (m: Message) => void;
  onClose: () => void;
};

/** খোঁজা শব্দটা ফলাফলে হলুদ দাগে দেখায় */
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim();
  if (!t) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const needle = t.toLocaleLowerCase();
  // লম্বা মেসেজে মিলের আশেপাশের অংশটুকু দেখাই
  const at = lower.indexOf(needle);
  // শব্দের মাঝখান থেকে না কেটে আগের ফাঁকা জায়গা থেকে শুরু
  const start = at > 40 ? Math.max(0, text.lastIndexOf(' ', at - 20) + 1) : 0;
  const shown = (start > 0 ? '…' : '') + text.slice(start, start + 160) + (text.length > start + 160 ? '…' : '');
  const parts: React.ReactNode[] = [];
  let rest = shown;
  let i = 0;
  while (rest) {
    const idx = rest.toLocaleLowerCase().indexOf(needle);
    if (idx < 0) {
      parts.push(rest);
      break;
    }
    if (idx > 0) parts.push(rest.slice(0, idx));
    parts.push(<mark key={i++}>{rest.slice(idx, idx + t.length)}</mark>);
    rest = rest.slice(idx + t.length);
  }
  return <>{parts}</>;
}

/** হেডারের 🔍 → পুরো চ্যাটে লেখা খোঁজা */
export function SearchPanel({ meId, partnerName, onSearch, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Message[] | null>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // লেখা থামার ৩০০ মিলিসেকেন্ড পর খোঁজে
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await onSearch(term);
      if (my !== seq.current) return; // পুরোনো খোঁজের ফল বাদ
      setResults(r);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, onSearch]);

  const term = q.trim();

  return (
    <div className="search-panel" role="dialog" aria-modal="true" aria-label="মেসেজ খুঁজুন">
      <div className="search-bar">
        <SearchIcon size={20} className="search-bar-icon" />
        <input
          ref={inputRef}
          type="search"
          placeholder="মেসেজে খুঁজুন…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          enterKeyHint="search"
          aria-label="খোঁজার শব্দ"
        />
        <button className="icon-btn" aria-label="খোঁজা বন্ধ করুন" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="search-results" aria-live="polite">
        {term.length < 2 ? (
          <p className="search-empty">অন্তত ২ অক্ষর লিখুন। পুরো চ্যাটের সব মেসেজে খোঁজা হবে।</p>
        ) : loading ? (
          <div className="search-empty">
            <span className="spinner spinner-dark" aria-label="খোঁজা হচ্ছে" />
          </div>
        ) : results === null ? (
          <p className="search-empty">খোঁজা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।</p>
        ) : results.length === 0 ? (
          <p className="search-empty">&ldquo;{term}&rdquo; লেখা কোনো মেসেজ পাওয়া যায়নি।</p>
        ) : (
          <>
            <p className="search-count">
              {results.length.toLocaleString('bn-BD')}টি মেসেজ পাওয়া গেছে{results.length >= 60 ? ' (সবচেয়ে নতুন ৬০টি)' : ''}
            </p>
            <ul>
              {results.map((m) => (
                <li key={m.id}>
                  <button className="search-hit" onClick={() => onPick(m)}>
                    <span className={`search-who ${m.sender_id === meId ? 'is-me' : 'is-them'}`}>
                      {m.sender_id === meId ? 'আপনি' : partnerName}
                      <time dateTime={m.created_at}>{formatFull(m.created_at)}</time>
                    </span>
                    <span className="search-text">
                      <Highlight text={m.content ?? ''} term={term} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
