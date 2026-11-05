'use client';

import { useEffect, useState } from 'react';
import { CloseIcon } from './Icons';
import { RPS, rpsOutcome, type RpsChoice, type RpsRound, type RpsScore } from '@/hooks/useRps';

type Props = {
  meId: string;
  partnerName: string;
  round: RpsRound | null;
  myPick: RpsChoice | null;
  result: { mine: RpsChoice; theirs: RpsChoice } | null;
  score: RpsScore;
  onStart: () => Promise<string | null>;
  onPick: (c: RpsChoice) => Promise<string | null>;
  onClose: () => void;
};

const CHOICES: RpsChoice[] = ['rock', 'paper', 'scissors'];
const bn = (n: number) => n.toLocaleString('bn-BD');

export function RpsDialog({ meId, partnerName, round, myPick, result, score, onStart, onPick, onClose }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // ফল এলে প্রথমে একটু ঝাঁকুনি, তারপর প্রকাশ
  const [revealed, setRevealed] = useState(false);
  const resultKey = result ? `${round?.id}-${result.mine}-${result.theirs}` : '';

  useEffect(() => {
    if (!resultKey) return setRevealed(false);
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(t);
  }, [resultKey]);

  const open = !!round && !round.done_at;
  const theyPicked = !!round && round.picked_count - (myPick ? 1 : 0) > 0;

  const start = async () => {
    setBusy(true);
    setError('');
    const err = await onStart();
    setBusy(false);
    if (err) setError(`শুরু করা যায়নি। ${err}`);
  };
  const pick = async (c: RpsChoice) => {
    setError('');
    const err = await onPick(c);
    if (err) setError(`পাঠানো যায়নি। ${err}`);
  };

  let body: React.ReactNode;
  if (result) {
    const o = rpsOutcome(result.mine, result.theirs);
    body = (
      <div className="rps-stage">
        <div className={`rps-faceoff ${revealed ? 'is-revealed' : ''}`}>
          <div className="rps-side">
            <span className="rps-hand me">{revealed ? RPS[result.mine].emoji : '✊'}</span>
            <span className="rps-label">আপনি{revealed ? ` · ${RPS[result.mine].name}` : ''}</span>
          </div>
          <span className="rps-vs">বনাম</span>
          <div className="rps-side">
            <span className="rps-hand them">{revealed ? RPS[result.theirs].emoji : '✊'}</span>
            <span className="rps-label">
              {partnerName}
              {revealed ? ` · ${RPS[result.theirs].name}` : ''}
            </span>
          </div>
        </div>
        <p className={`rps-verdict ${revealed ? `is-${o}` : ''}`} aria-live="polite">
          {!revealed ? 'এক… দুই… তিন…' : o === 'win' ? '🎉 আপনি জিতেছেন!' : o === 'lose' ? `${partnerName} জিতেছেন!` : '🤝 ড্র হলো!'}
        </p>
        {revealed && (
          <button className="primary-btn rps-again" onClick={start} disabled={busy}>
            {busy ? <span className="spinner" /> : 'আবার খেলুন'}
          </button>
        )}
      </div>
    );
  } else if (open && myPick) {
    body = (
      <div className="rps-stage">
        <span className="rps-hand big me rps-wait-hand">{RPS[myPick].emoji}</span>
        <p className="rps-status">
          আপনি <b>{RPS[myPick].name}</b> বেছেছেন — গোপন রাখা হয়েছে।
        </p>
        <p className="muted hint">
          {theyPicked ? 'দুজনেরটা মিলিয়ে দেখা হচ্ছে…' : `${partnerName}-এর বাছাইয়ের অপেক্ষা…`}
          <span className="rps-dots" aria-hidden />
        </p>
      </div>
    );
  } else if (open) {
    const startedByMe = round!.started_by === meId;
    body = (
      <div className="rps-stage">
        <p className="rps-status">
          {startedByMe
            ? theyPicked
              ? `${partnerName} বেছে ফেলেছেন! এবার আপনার পালা`
              : 'আপনার হাত বাছুন — কেউ কারোটা দেখবে না'
            : `${partnerName} খেলতে ডেকেছেন! আপনার হাত বাছুন`}
        </p>
        <div className="rps-choices" role="group" aria-label="বাছাই করুন">
          {CHOICES.map((c) => (
            <button key={c} className="rps-choice" onClick={() => pick(c)}>
              <span className="rps-hand">{RPS[c].emoji}</span>
              <span>{RPS[c].name}</span>
            </button>
          ))}
        </div>
        <p className="muted hint rps-rule">পাথর কাঁচি ভাঙে · কাঁচি কাগজ কাটে · কাগজ পাথর ঢাকে</p>
      </div>
    );
  } else {
    body = (
      <div className="rps-stage">
        <div className="rps-trio" aria-hidden>
          <span>✊</span>
          <span>✋</span>
          <span>✌️</span>
        </div>
        <p className="muted hint">
          {partnerName}-কে খেলতে ডাকুন। দুজনেই গোপনে বাছবেন, দুজনেরটা হয়ে গেলে একসাথে ফল দেখাবে।
        </p>
        <button className="primary-btn" onClick={start} disabled={busy}>
          {busy ? <span className="spinner" /> : 'খেলতে ডাকুন'}
        </button>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog rps-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rps-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id="rps-title">রক-পেপার-সিজর্স</h2>
          <button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="rps-score" aria-label="মোট হিসাব">
          <div>
            <b>{bn(score.my_wins)}</b>
            <span>আপনি</span>
          </div>
          <div className="rps-score-draw">
            <b>{bn(score.draws)}</b>
            <span>ড্র</span>
          </div>
          <div>
            <b>{bn(score.their_wins)}</b>
            <span>{partnerName}</span>
          </div>
        </div>

        {body}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
