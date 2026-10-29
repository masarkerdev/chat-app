'use client';

import { useEffect, useState } from 'react';

const HEARTS = ['💞', '❤️', '💗', '💕', '💖'];

type Burst = { key: number; hearts: { left: number; delay: number; size: number; emoji: string; drift: number }[] };

/**
 * "মনে পড়ছে" এলে পর্দায় নিচ থেকে হৃদয় ভেসে ওঠে, সাথে একটা বার্তা।
 * trigger বদলালেই একবার চলে।
 */
export function NudgeLayer({ trigger, message }: { trigger: number | null; message: string }) {
  const [burst, setBurst] = useState<Burst | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setBurst({
      key: trigger,
      hearts: reduce
        ? []
        : Array.from({ length: 16 }, (_, i) => ({
            left: 6 + Math.random() * 88,
            delay: Math.random() * 0.9,
            size: 22 + Math.random() * 22,
            emoji: HEARTS[i % HEARTS.length],
            drift: (Math.random() - 0.5) * 80,
          })),
    });
    setShowText(true);
    navigator.vibrate?.([60, 80, 60]);
    const t1 = setTimeout(() => setShowText(false), 3200);
    const t2 = setTimeout(() => setBurst(null), 3600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [trigger]);

  if (!burst) return null;
  return (
    <div className="nudge-layer" aria-live="assertive">
      {burst.hearts.map((h, i) => (
        <span
          key={`${burst.key}-${i}`}
          className="nudge-heart"
          style={
            {
              left: `${h.left}%`,
              fontSize: h.size,
              animationDelay: `${h.delay}s`,
              '--drift': `${h.drift}px`,
            } as React.CSSProperties
          }
        >
          {h.emoji}
        </span>
      ))}
      {showText && <div className="nudge-toast">{message}</div>}
    </div>
  );
}
