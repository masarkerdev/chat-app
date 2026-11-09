'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CloseIcon,
  FileIcon,
  ImageIcon,
  MicIcon,
  PaperclipIcon,
  PenIcon,
  ReplyIcon,
  SendIcon,
  TrashIcon,
} from './Icons';
import { formatDuration, MAX_VOICE_MS, pickVoiceMime } from '@/lib/media';

export type ReplyDraft = {
  /** যার মেসেজের উত্তর দেওয়া হচ্ছে */
  name: string;
  text: string;
  byMe: boolean;
};

type Props = {
  disabled?: boolean;
  reply?: ReplyDraft | null;
  onCancelReply?: () => void;
  /** এডিট মোড: আগের লেখা */
  editing?: { text: string } | null;
  onCancelEdit?: () => void;
  onSend: (text: string) => void;
  onImage: (file: File) => Promise<string | null>;
  onFile: (file: File) => Promise<string | null>;
  onVoice: (blob: Blob, durationMs: number) => string | null;
  onTyping: (typing: boolean) => void;
};

const MAX_LEN = 4000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

type Rec = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  /** থামানোর পর পাঠাবে নাকি ফেলে দেবে */
  send: boolean;
};

export function Composer({
  disabled,
  reply,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onImage,
  onFile,
  onVoice,
  onTyping,
}: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [level, setLevel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouch = useRef(false);
  const rec = useRef<Rec | null>(null);
  const recTick = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    isTouch.current = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch.current) taRef.current?.focus();
  }, []);

  // রিপ্লাই বাছলে সাথে সাথে লেখার জায়গায় কার্সর
  useEffect(() => {
    if (reply) taRef.current?.focus();
  }, [reply]);

  // এডিট শুরু হলে আগের লেখা বসে, কার্সর শেষে যায়; বাতিল হলে খালি হয়
  const editKey = editing?.text;
  useEffect(() => {
    if (editKey === undefined) return;
    setText(editKey);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [editKey]);

  const cancelEdit = () => {
    setText('');
    onCancelEdit?.();
  };

  // টেক্সট অনুযায়ী উচ্চতা বাড়ে (সর্বোচ্চ ~৬ লাইন)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  }, [text]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4500);
    return () => clearTimeout(t);
  }, [error]);

  // সংযুক্তির মেনু: বাইরে চাপলে বা Esc দিলে বন্ধ
  useEffect(() => {
    if (!attachOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!attachRef.current?.contains(e.target as Node)) setAttachOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAttachOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachOpen]);

  // অন্য পেইজে গেলে বা কম্পোনেন্ট সরে গেলে মাইক বন্ধ
  useEffect(() => () => stopRecording(false), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** ছবি বাছলে ছবি হিসেবে (ছোট করে), অন্য সব ফাইল হিসেবে */
  const pickFiles = async (files: FileList | null, as: 'auto' | 'file') => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 10)) {
      const asImage = as === 'auto' && IMAGE_TYPES.includes(f.type);
      const err = asImage ? await onImage(f) : await onFile(f);
      if (err) setError(err);
    }
    if (imageRef.current) imageRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  };

  // ---------------------------------------------------------------- ভয়েস

  const cleanupRecording = () => {
    if (recTick.current) cancelAnimationFrame(recTick.current);
    recTick.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
    setRecMs(0);
    setLevel(0);
  };

  function stopRecording(send: boolean) {
    const r = rec.current;
    if (!r) return;
    r.send = send;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    else cleanupRecording();
  }

  const startRecording = async () => {
    if (disabled || rec.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('এই ব্রাউজারে ভয়েস রেকর্ড করা যায় না।');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'মাইক্রোফোনের অনুমতি দেওয়া হয়নি। ব্রাউজারের সাইট সেটিংস থেকে Microphone → Allow করুন।'
          : name === 'NotFoundError'
          ? 'কোনো মাইক্রোফোন পাওয়া যায়নি।'
          : 'মাইক্রোফোন চালু করা যায়নি।'
      );
      return;
    }

    const mimeType = pickVoiceMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError('ভয়েস রেকর্ড শুরু করা যায়নি।');
      return;
    }

    const r: Rec = { recorder, stream, chunks: [], startedAt: performance.now(), send: false };
    rec.current = r;
    recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    recorder.onstop = () => {
      const ms = performance.now() - r.startedAt;
      const blob = new Blob(r.chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      cleanupRecording();
      if (r.send) {
        const err = onVoice(blob, ms);
        if (err) setError(err);
      }
    };
    recorder.start(1000);
    setRecording(true);
    stopTyping();

    // কথার জোর দেখানোর জন্য ছোট্ট মিটার (না চললেও রেকর্ড হবে)
    let analyser: AnalyserNode | null = null;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const tick = () => {
      if (rec.current !== r) return;
      const ms = performance.now() - r.startedAt;
      setRecMs(ms);
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += ((buf[i] - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      }
      if (ms >= MAX_VOICE_MS) {
        stopRecording(true);
        return;
      }
      recTick.current = requestAnimationFrame(tick);
    };
    recTick.current = requestAnimationFrame(tick);
  };

  const showMic = !text.trim() && !editing;

  if (recording) {
    return (
      <div className="composer composer-recording" role="group" aria-label="ভয়েস রেকর্ড হচ্ছে">
        {error && <div className="composer-error" role="alert">{error}</div>}
        <button type="button" className="icon-btn rec-cancel" aria-label="রেকর্ড বাতিল" onClick={() => stopRecording(false)}>
          <TrashIcon size={21} />
        </button>
        <div className="rec-field">
          <span className="rec-dot" style={{ scale: String(1 + level * 0.9) }} aria-hidden />
          <span className="rec-time" aria-live="off">
            {formatDuration(recMs)}
          </span>
          <span className="rec-hint">রেকর্ড হচ্ছে…</span>
          <span className="rec-max">সর্বোচ্চ {formatDuration(MAX_VOICE_MS)}</span>
        </div>
        <button type="button" className="send-btn" aria-label="ভয়েস পাঠান" onClick={() => stopRecording(true)}>
          <SendIcon size={20} />
        </button>
      </div>
    );
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {error && <div className="composer-error" role="alert">{error}</div>}

      {editing && (
        <div className="reply-bar quote-me">
          <PenIcon size={18} className="reply-bar-icon" />
          <div className="reply-bar-body">
            <span className="quote-name">মেসেজ এডিট করছেন</span>
            <span className="quote-text">{editing.text}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="এডিট বাতিল" onClick={cancelEdit}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}

      {reply && !editing && (
        <div className={`reply-bar ${reply.byMe ? 'quote-me' : 'quote-them'}`}>
          <ReplyIcon size={18} className="reply-bar-icon" />
          <div className="reply-bar-body">
            <span className="quote-name">{reply.byMe ? 'নিজের মেসেজের' : `${reply.name}-এর মেসেজের`} উত্তর</span>
            <span className="quote-text">{reply.text}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="রিপ্লাই বাতিল" onClick={onCancelReply}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}

      <div className="attach-wrap" ref={attachRef}>
        <button
          type="button"
          className={`icon-btn composer-attach ${attachOpen ? 'is-open' : ''}`}
          aria-label="ছবি বা ফাইল পাঠান"
          aria-haspopup="menu"
          aria-expanded={attachOpen}
          disabled={disabled || !!editing}
          onClick={() => setAttachOpen((v) => !v)}
        >
          <PaperclipIcon />
        </button>
        {attachOpen && (
          <div className="attach-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAttachOpen(false);
                imageRef.current?.click();
              }}
            >
              <span className="attach-ico is-image">
                <ImageIcon size={20} />
              </span>
              <span>
                ছবি
                <small>ছোট করে পাঠানো হয়</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAttachOpen(false);
                fileRef.current?.click();
              }}
            >
              <span className="attach-ico is-file">
                <FileIcon size={20} />
              </span>
              <span>
                ফাইল
                <small>PDF, Word, ZIP… সর্বোচ্চ ২৫ MB</small>
              </span>
            </button>
          </div>
        )}
      </div>
      <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickFiles(e.target.files, 'auto')} />
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => pickFiles(e.target.files, 'file')} />

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
            if (e.key === 'Escape' && editing) {
              cancelEdit();
              return;
            }
            if (e.key === 'Escape' && reply) {
              onCancelReply?.();
              return;
            }
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
              pickFiles(files, 'auto');
            }
          }}
        />
      </div>

      {showMic ? (
        <button
          type="button"
          className="send-btn mic-btn"
          aria-label="ভয়েস মেসেজ রেকর্ড করুন"
          disabled={disabled}
          onClick={startRecording}
        >
          <MicIcon size={22} />
        </button>
      ) : (
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
      )}
    </form>
  );
}
