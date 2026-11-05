'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { notifyPartner } from '@/lib/push';

export type RpsChoice = 'rock' | 'paper' | 'scissors';

export type RpsRound = {
  id: string;
  started_by: string;
  created_at: string;
  picked_count: number;
  done_at: string | null;
};

export type RpsScore = { my_wins: number; their_wins: number; draws: number };

export const RPS: Record<RpsChoice, { emoji: string; name: string }> = {
  rock: { emoji: '✊', name: 'পাথর' },
  paper: { emoji: '✋', name: 'কাগজ' },
  scissors: { emoji: '✌️', name: 'কাঁচি' },
};

const BEATS: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** 'win' = আমি জিতেছি, 'lose' = অপর জন, 'draw' = ড্র */
export function rpsOutcome(mine: RpsChoice, theirs: RpsChoice) {
  if (mine === theirs) return 'draw' as const;
  return BEATS[mine] === theirs ? ('win' as const) : ('lose' as const);
}

const DAY_MS = 24 * 3600 * 1000;

/** রক-পেপার-সিজর্স: চলমান খেলা, নিজের বাছাই, ফল ও মোট হিসাব — রিয়েলটাইমে */
export function useRps(meId: string | null) {
  const [round, setRound] = useState<RpsRound | null>(null);
  const [myPick, setMyPick] = useState<RpsChoice | null>(null);
  const [result, setResult] = useState<{ mine: RpsChoice; theirs: RpsChoice } | null>(null);
  const [score, setScore] = useState<RpsScore>({ my_wins: 0, their_wins: 0, draws: 0 });
  /** অপর জন নতুন করে খেলতে ডাকলে বাড়ে (আমন্ত্রণ দেখানোর জন্য) */
  const [inviteAt, setInviteAt] = useState(0);
  const roundRef = useRef<RpsRound | null>(null);
  roundRef.current = round;

  const loadScore = useCallback(async () => {
    const { data } = await getSupabase().rpc('rps_score');
    const row = (Array.isArray(data) ? data[0] : data) as RpsScore | undefined;
    if (row) setScore({ my_wins: row.my_wins ?? 0, their_wins: row.their_wins ?? 0, draws: row.draws ?? 0 });
  }, []);

  /** খেলা শেষ হলে দুজনের বাছাই আনে */
  const loadPicks = useCallback(
    async (r: RpsRound) => {
      const { data } = await getSupabase().from('rps_picks').select('user_id, choice').eq('round_id', r.id);
      const rows = (data ?? []) as { user_id: string; choice: RpsChoice }[];
      const mine = rows.find((x) => x.user_id === meId)?.choice ?? null;
      const theirs = rows.find((x) => x.user_id !== meId)?.choice ?? null;
      setMyPick(mine);
      if (r.done_at && mine && theirs) {
        setResult({ mine, theirs });
        loadScore();
      } else setResult(null);
    },
    [meId, loadScore]
  );

  // শুরুতে: সর্বশেষ খেলা (২৪ ঘণ্টার মধ্যের চলমান থাকলে সেটা)
  useEffect(() => {
    if (!meId) return;
    const sb = getSupabase();
    let channel: RealtimeChannel | null = null;
    (async () => {
      const { data } = await sb
        .from('rps_rounds')
        .select('id, started_by, created_at, picked_count, done_at')
        .is('done_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const open = (data?.[0] as RpsRound | undefined) ?? null;
      if (open && Date.now() - new Date(open.created_at).getTime() < DAY_MS) {
        setRound(open);
        loadPicks(open);
      }
      loadScore();

      channel = sb
        .channel('rps-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rps_rounds' }, (p) => {
          const r = p.new as RpsRound;
          setRound(r);
          setMyPick(null);
          setResult(null);
          if (r.started_by !== meId) setInviteAt(Date.now());
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rps_rounds' }, (p) => {
          const r = p.new as RpsRound;
          if (roundRef.current && roundRef.current.id !== r.id) return;
          setRound(r);
          if (r.done_at) loadPicks(r);
        })
        .subscribe();
    })();
    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [meId, loadPicks, loadScore]);

  /** খেলা শুরু (চলমান থাকলে সেটাতেই যোগ দেয়) */
  const start = useCallback(async (): Promise<string | null> => {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('rps_start');
    if (error) {
      console.error('খেলা শুরু করা যায়নি', error);
      return error.message;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { round_id: string; created: boolean };
    const { data: r } = await sb
      .from('rps_rounds')
      .select('id, started_by, created_at, picked_count, done_at')
      .eq('id', row.round_id)
      .single();
    if (r) {
      setRound(r as RpsRound);
      if (row.created) {
        setMyPick(null);
        setResult(null);
        notifyPartner(row.round_id, 'rps');
      } else loadPicks(r as RpsRound);
    }
    return null;
  }, [loadPicks]);

  const pick = useCallback(async (choice: RpsChoice): Promise<string | null> => {
    const r = roundRef.current;
    if (!r || r.done_at) return 'খেলা চলছে না';
    setMyPick(choice);
    const { error } = await getSupabase().rpc('rps_pick', { p_round_id: r.id, p_choice: choice });
    if (error) {
      console.error('বাছাই পাঠানো যায়নি', error);
      setMyPick(null);
      return error.message;
    }
    return null;
  }, []);

  /** অপর জন ডেকেছেন কিন্তু আমি এখনো বাছিনি */
  const pendingInvite = !!round && !round.done_at && round.started_by !== meId && !myPick;

  return { round, myPick, result, score, start, pick, pendingInvite, inviteAt };
}
