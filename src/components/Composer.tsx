'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, SendIcon } from './Icons';

type Props = {
  disabled?: boolean;
  onSend: (text: string) => void;
  onImage: (file: File) => Promise<string | null>;
  onTyping: (typing: boolean) => void;
};

const MAX_LEN = 4000;

export function Composer({ disabled, onSend, onImage, onTyping }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouch = useRef(false);

  useEffect(() => {
    isTouch.current = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch.current) taRef.current?.focus();
  }, []);

  // টেক্সট অনুযায়ী উচ্চতা বাড়ে (সর্বোচ্চ ~৬ লাইন)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  }, [text]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const stopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    onTyping(false);
  };

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    if (value.length > MAX_LEN) {
      setError(`মেসেজ সর্বোচ্চ ${MAX_LEN.toLocaleString('bn-BD')} অক্ষরের হতে পারে।`);
      return;
    }
    onSend(value);
    setText('');
    stopTyping();
    // মোবাইলে কিবোর্ড খোলা রাখি
    taRef.current?.focus();
  };

  const onChange = (v: string) => {
    setText(v);
    if (!v.trim()) {
      stopTyping();
      return;
    }
    onTyping(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => onTyping(false), 3000);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 10)) {
      const err = await onImage(f);
      if (err) setError(err);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {error && <div className="composer-error" role="alert">{error}</div>}

      <button
        type="button"
        className="icon-btn composer-attach"
        aria-label="ছবি পাঠান"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
      >
        <ImageIcon />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => pickFiles(e.target.files)}
      />

      <div className="composer-field">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="মেসেজ লিখুন…"
          aria-label="মেসেজ"
          disabled={disabled}
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            // ডেস্কটপে Enter = পাঠান, Shift+Enter = নতুন লাইন; মোবাইলে Enter = নতুন লাইন
            if (e.key === 'Enter' && !e.shiftKey && !isTouch.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (files && files.length) {
              e.preventDefault();
              pickFiles(files);
            }
          }}
        />
      </div>

      <button
        type="submit"
        className="send-btn"
        aria-label="পাঠান"
        disabled={disabled || !text.trim()}
        // ট্যাপ করলে কিবোর্ড যেন বন্ধ না হয়
        onPointerDown={(e) => e.preventDefault()}
      >
        <SendIcon size={20} />
      </button>
    </form>
  );
}
