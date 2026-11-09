'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@/lib/types';
import { downloadFile, fileBadge, formatBytes, formatDuration, waveFor } from '@/lib/media';
import { getSignedUrl } from '@/hooks/useSignedUrl';
import { DownloadIcon, PauseIcon, PlayIcon } from './Icons';

/** একসাথে একটাই ভয়েস বাজবে */
const PLAY_EVENT = 'dujone-voice-play';

/** ভয়েস মেসেজ: বাজানো/থামানো, সুতোর ফোঁড়ের মতো ঢেউ, টেনে সামনে-পেছনে যাওয়া */
export function VoicePlayer({ msg }: { msg: Message }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0); // মিলিসেকেন্ড
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const total = msg.duration_ms ?? 0;
  const bars = useMemo(() => waveFor(msg.id), [msg.id]);
  const progress = total ? Math.min(1, pos / total) : 0;

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== msg.id) audioRef.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => {
      window.removeEventListener(PLAY_EVENT, onOther);
      audioRef.current?.pause();
    };
  }, [msg.id]);

  /** প্রথমবার বাজানোর সময় লিংক নেয় (৫ মিনিটের) */
  const ensureAudio = async () => {
    if (audioRef.current) return audioRef.current;
    const src = msg.localUrl ?? (msg.image_path ? await getSignedUrl(msg.image_path) : null);
    if (!src) throw new Error('no url');
    const a = new Audio();
    a.preload = 'auto';
    a.src = src;
    a.playbackRate = speed;
    a.ontimeupdate = () => setPos(a.currentTime * 1000);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.onended = () => {
      setPlaying(false);
      setPos(0);
    };
    a.onerror = async () => {
      // লিংকের মেয়াদ ফুরালে একবার নতুন লিংক
      if (msg.image_path && !msg.localUrl && !a.dataset.retried) {
        a.dataset.retried = '1';
        const fresh = await getSignedUrl(msg.image_path, true);
        if (fresh) {
          a.src = fresh;
          a.play().catch(() => setFailed(true));
          return;
        }
      }
      setFailed(true);
      setPlaying(false);
      setLoading(false);
    };
    audioRef.current = a;
    return a;
  };

  const toggle = async () => {
    try {
      const a = await ensureAudio();
      if (!a.paused) return a.pause();
      setFailed(false);
      setLoading(true);
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: msg.id }));
      await a.play();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const seek = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    try {
      const a = await ensureAudio();
      a.currentTime = (ratio * total) / 1000;
      setPos(ratio * total);
    } catch {
      setFailed(true);
    }
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className={`voice ${playing ? 'is-playing' : ''}`}>
      <button
        className="voice-play"
        aria-label={playing ? 'থামান' : 'ভয়েস মেসেজ শুনুন'}
        onClick={toggle}
        disabled={msg.failed}
      >
        {loading ? <span className="spinner" /> : playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <div className="voice-body">
        <div
          className="voice-wave"
          role="slider"
          aria-label="কোথা থেকে শুনবেন"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(pos / 1000)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.stopPropagation();
            seek(e);
          }}
          onKeyDown={async (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const a = await ensureAudio().catch(() => null);
            if (!a) return;
            a.currentTime = Math.max(0, a.currentTime + (e.key === 'ArrowRight' ? 5 : -5));
          }}
        >
          {bars.map((h, i) => (
            <i key={i} className={i / bars.length < progress ? 'on' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <div className="voice-meta">
          <span>{failed ? 'বাজানো যায়নি' : formatDuration(playing || pos ? pos : total)}</span>
          {(playing || pos > 0) && (
            <button className="voice-speed" onClick={cycleSpeed} aria-label="গতি বদলান">
              {speed.toLocaleString('bn-BD')}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ফাইল: ধরন, নাম, আকার — চাপলে নামবে */
export function FileCard({ msg }: { msg: Message }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = msg.file_name ?? 'ফাইল';
  const canDownload = !msg.pending && !msg.failed && !!msg.image_path;

  const download = async () => {
    if (!canDownload) {
      // নিজের পাঠানো, এখনো আপলোড হয়নি — লোকাল কপি খুলি
      if (msg.localFile) {
        const url = URL.createObjectURL(msg.localFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      return;
    }
    setBusy(true);
    setError('');
    try {
      await downloadFile(msg.image_path!, name);
    } catch {
      setError('নামানো যায়নি, আবার চেষ্টা করুন');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="file-card" onClick={download} aria-label={`${name} ফাইল নামান`}>
      <span className="file-badge" aria-hidden>
        {fileBadge(name)}
      </span>
      <span className="file-info">
        <span className="file-name" title={name}>
          {name}
        </span>
        <span className="file-size">
          {error || (msg.pending ? 'আপলোড হচ্ছে…' : formatBytes(msg.file_size))}
        </span>
      </span>
      <span className="file-dl" aria-hidden>
        {busy || msg.pending ? <span className="spinner" /> : <DownloadIcon size={18} />}
      </span>
    </button>
  );
}
