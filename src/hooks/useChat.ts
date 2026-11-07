'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, IMAGE_BUCKET, PAGE_SIZE, supabaseAnonKey, supabaseBase } from '@/lib/supabase';
import { compressImage, extFor } from '@/lib/image';
import { clearNotifications, disablePush, isPushActive, notifyPartner, syncPush, unsubscribeLocal } from '@/lib/push';
import { sessionIdFromToken } from '@/lib/devices';
import { disappearLabel, setServerOffset } from '@/lib/format';
import { clearLock, isLocked } from '@/lib/applock';
import type { Message, Pin, Profile, Reaction } from '@/lib/types';

const ROOM = 'room:dujone';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BASE_TITLE = 'Dujone';
/** মেসেজের সাথে রিঅ্যাকশনও একসাথে আনে */
const MSG_COLS =
  'id, sender_id, content, image_path, created_at, seen_at, edited_at, expires_at, reply_to, reactions:message_reactions(user_id, emoji)';

/** ছবিগুলো স্টোরেজ থেকে মোছা (১০০টি করে) */
async function removeImages(paths: (string | null)[]) {
  const list = paths.filter((p): p is string => !!p);
  for (let i = 0; i < list.length; i += 100) {
    await getSupabase().storage.from(IMAGE_BUCKET).remove(list.slice(i, i + 100));
  }
}

type Status = 'loading' | 'ready' | 'not-member' | 'error';

/** Supabase-এর ইংরেজি এররকে বোঝার মতো বাংলায় */
export function explainError(err: { message?: string; code?: string } | null | undefined): string {
  if (!err) return 'পাঠানো যায়নি';
  const m = (err.message ?? '').toLowerCase();
  // কলাম/টেবিল/সম্পর্ক পাওয়া যায়নি = নতুন schema.sql চালানো হয়নি
  if (
    ['PGRST204', 'PGRST200', 'PGRST205', '42703', '42P01'].includes(err.code ?? '') ||
    m.includes('column') ||
    m.includes('relationship') ||
    m.includes('schema cache')
  )
    return 'ডাটাবেস আপডেট হয়নি: Supabase-এ নতুন schema.sql আবার Run করুন';
  if (err.code === '42501' || m.includes('row-level security')) return 'অনুমতি নেই: আপনি এই চ্যাটের সদস্য কিনা দেখুন';
  if (m.includes('jwt') || m.includes('token')) return 'লগইনের মেয়াদ শেষ: আবার লগইন করুন';
  if (m.includes('fetch') || m.includes('network') || m.includes('failed to')) return 'ইন্টারনেট সংযোগ নেই';
  if (m.includes('payload too large') || m.includes('exceeded')) return 'ফাইল খুব বড়';
  // অচেনা এরর: সার্ভারের আসল কারণটাই দেখাই, যাতে সমস্যা ধরা যায়
  return err.message ? `সার্ভারের উত্তর: ${err.message}` : 'সমস্যা হয়েছে, আবার চেষ্টা করুন';
}

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function byTime(a: Message, b: Message) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** সার্ভার থেকে আসা মেসেজ তালিকায় মেশায় (ডুপ্লিকেট ছাড়া) */
function merge(list: Message[], incoming: Message[]) {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = map.get(m.id);
    map.set(
      m.id,
      prev
        ? { ...prev, ...m, pending: false, failed: false, localFile: undefined }
        : { ...m, reactions: m.reactions ?? [] }
    );
  }
  return [...map.values()].sort(byTime);
}

/** একটি মেসেজের রিঅ্যাকশন তালিকায় একজনের রিঅ্যাকশন বসায় / সরায় */
function withReaction(list: Message[], messageId: string, userId: string, emoji: string | null) {
  return list.map((m) => {
    if (m.id !== messageId) return m;
    const others = (m.reactions ?? []).filter((r) => r.user_id !== userId);
    return { ...m, reactions: emoji ? [...others, { user_id: userId, emoji }] : others };
  });
}

export function useChat() {
  const router = useRouter();

  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState('');
  const [me, setMe] = useState<Profile | null>(null);
  const [partner, setPartner] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [connected, setConnected] = useState(true);
  /** তালিকায় নেই এমন পুরোনো মেসেজ, যার রিপ্লাই দেখানো হচ্ছে */
  const [quotes, setQuotes] = useState<Record<string, Message | null>>({});
  /** পিন করা মেসেজ (নতুনটা আগে) */
  const [pins, setPins] = useState<Pin[]>([]);
  /** অপর জন "মনে পড়ছে" পাঠালে */
  const [incomingNudge, setIncomingNudge] = useState<{ id: string; at: number } | null>(null);
  /** নতুন মেসেজ কত সেকেন্ড পর মুছে যাবে (০ = বন্ধ) */
  const [disappearSeconds, setDisappearSeconds] = useState(0);
  /** অপর জনের কোনো কাজের খবর (চ্যাট মোছা, টাইমার বদল) — পেইজে ছোট বার্তা হিসেবে দেখায় */
  const [chatNotice, setChatNotice] = useState<{ text: string; at: number } | null>(null);
  /** মেসেজ লোড করতে সমস্যা হলে উপরে দেখানোর বার্তা */
  const [loadError, setLoadError] = useState('');

  const meRef = useRef<Profile | null>(null);
  const partnerRef = useRef<Profile | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const roomRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadHidden = useRef(0);
  const loadingOlderRef = useRef(false);
  /** এই লগইনের session_id — অন্য ডিভাইস থেকে লগআউট সংকেত চিনতে */
  const mySession = useRef<string | null>(null);
  /** নিজে "লগআউট" চাপলে true; না হলে লগআউট মানে অন্য ডিভাইস থেকে বের করে দেওয়া */
  const manualLogout = useRef(false);

  messagesRef.current = messages;

  // ---------------------------------------------------------------- helpers

  const updateTitle = useCallback(() => {
    const n = unreadHidden.current;
    document.title = n > 0 ? `(${n.toLocaleString('bn-BD')}) ${BASE_TITLE}` : BASE_TITLE;
  }, []);

  const markSeen = useCallback(() => {
    // লক স্ক্রিন খোলা থাকলে "দেখেছে" দেখানো যাবে না
    if (document.visibilityState !== 'visible' || isLocked()) return;
    const uid = meRef.current?.id;
    if (!uid) return;
    const hasUnseen = messagesRef.current.some((m) => m.sender_id !== uid && !m.seen_at);
    if (!hasUnseen) return;
    if (seenTimer.current) clearTimeout(seenTimer.current);
    seenTimer.current = setTimeout(() => {
      getSupabase().rpc('mark_seen').then(() => {});
    }, 350);
  }, []);

  const tokenRef = useRef<string | null>(null);
  /**
   * "সর্বশেষ সক্রিয়" সময় সার্ভারের ঘড়ি দিয়ে লেখা হয় (ফোনের ঘড়ি ভুল থাকলেও ঠিক থাকে)।
   * keepalive: অ্যাপ বন্ধ/ব্যাকগ্রাউন্ডে যাওয়ার মুহূর্তেও রিকোয়েস্টটা শেষ হয়।
   */
  const touchLastSeen = useCallback(() => {
    const uid = meRef.current?.id;
    const token = tokenRef.current;
    if (!uid || !token) return;
    const t0 = Date.now();
    fetch(`${supabaseBase()}/rest/v1/rpc/touch_last_seen`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: supabaseAnonKey(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async (r) => {
        if (r.ok) {
          const ts = await r.json().catch(() => null);
          if (typeof ts === 'string') setServerOffset(new Date(ts).getTime() - (t0 + Date.now()) / 2);
        } else if (r.status === 404) {
          // schema.sql নতুন করে চালানো না হলে পুরোনো পদ্ধতি
          getSupabase().from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', uid).then(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const notify = useCallback(async (m: Message) => {
    unreadHidden.current += 1;
    updateTitle();
    // push চালু থাকলে service worker নিজেই নোটিফিকেশন দেখাবে — দুবার যেন না বাজে
    if (isPushActive()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const title = partnerRef.current?.display_name ?? 'নতুন মেসেজ';
    const body = m.content?.trim() ? m.content : '📷 একটি ছবি পাঠিয়েছেন';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.showNotification(title, { body, tag: 'dujone-message', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
      } else {
        new Notification(title, { body, icon: '/icons/icon-192.png' });
      }
    } catch {
      /* কিছু ব্রাউজারে নোটিফিকেশন সাপোর্ট নেই */
    }
  }, [updateTitle]);

  const loadPins = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('pinned_messages')
      .select('message_id, pinned_by, pinned_at, message:messages(id, sender_id, content, image_path, created_at, seen_at)')
      .order('pinned_at', { ascending: false });
    if (error) {
      console.warn('পিন লোড করা যায়নি', error);
      return;
    }
    setPins((data ?? []) as unknown as Pin[]);
  }, []);

  /** অন্য ডিভাইস থেকে লগআউট করা হলে: এই ডিভাইস পরিষ্কার করে লগইন পেইজে */
  const forceLogout = useCallback(async () => {
    if (manualLogout.current) return;
    manualLogout.current = true;
    clearLock();
    await unsubscribeLocal();
    await getSupabase().auth.signOut({ scope: 'local' });
    router.replace('/login?reason=revoked');
  }, [router]);

  /** এই লগইন এখনো বৈধ কিনা সার্ভারে যাচাই (অন্য ডিভাইস থেকে বাতিল হয়ে থাকতে পারে) */
  const validateSession = useCallback(async () => {
    const { error } = await getSupabase().auth.getUser();
    if (!error) return;
    const gone =
      error.code === 'session_not_found' ||
      /session.*(not found|does not exist)|session_id/i.test(error.message) ||
      error.status === 403;
    if (gone) forceLogout();
  }, [forceLogout]);

  const loadLatest = useCallback(async (initial = false) => {
    const { data, error } = await getSupabase()
      .from('messages')
      .select(MSG_COLS)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error || !data) {
      console.error('মেসেজ লোড করা যায়নি', error);
      setLoadError(explainError(error));
      return;
    }
    setLoadError('');
    const rows = (data as Message[]).reverse();
    setMessages((l) => (initial ? rows : merge(l, rows)));
    if (initial) setHasMore(rows.length === PAGE_SIZE);
  }, []);

  // ---------------------------------------------------------------- init + realtime

  useEffect(() => {
    const sb = getSupabase();
    let cancelled = false;
    let dbChannel: RealtimeChannel | null = null;
    let room: RealtimeChannel | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let everSubscribed = false;

    // সক্রিয় = অ্যাপ সামনে খোলা এবং গত ৫ মিনিটে কিছু ছোঁয়া/টাইপ হয়েছে।
    // শুধু খোলা ফেলে রাখলে (যেমন কম্পিউটারে ট্যাব খোলা) ৫ মিনিট পর "অনলাইন" থেকে সরে যায়।
    const IDLE_MS = 5 * 60_000;
    let active = false;
    let lastInput = Date.now();
    let partnerWasOnline = false;
    const goActive = () => {
      if (active || !room) return;
      active = true;
      room.track({ online_at: new Date().toISOString() });
      touchLastSeen();
    };
    const goAway = () => {
      if (!active) return;
      active = false;
      room?.untrack();
      touchLastSeen();
    };
    const onInput = () => {
      lastInput = Date.now();
      if (!active && document.visibilityState === 'visible') goActive();
    };
    const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        unreadHidden.current = 0;
        updateTitle();
        clearNotifications();
        lastInput = Date.now();
        goActive();
        loadLatest();
        markSeen();
        validateSession();
      } else {
        goAway();
      }
    };

    (async () => {
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (cancelled) return;
      if (!session) {
        router.replace('/login');
        return;
      }
      const uid = session.user.id;
      tokenRef.current = session.access_token;
      mySession.current = sessionIdFromToken(session.access_token);
      validateSession();

      const { data: profiles, error } = await sb
        .from('profiles')
        .select('id, display_name, avatar_url, last_seen');
      if (cancelled) return;
      if (error) {
        setErrorText(error.message);
        setStatus('error');
        return;
      }
      const mine = (profiles as Profile[]).find((p) => p.id === uid);
      if (!mine) {
        setStatus('not-member');
        return;
      }
      const other = (profiles as Profile[]).find((p) => p.id !== uid) ?? null;
      meRef.current = mine;
      partnerRef.current = other;
      setMe(mine);
      setPartner(other);

      await loadLatest(true);
      if (cancelled) return;
      setStatus('ready');
      loadPins();
      // টাইমারের সেটিং, আর মেয়াদ শেষ হওয়া মেসেজ (ও ছবি) সত্যিই মুছে ফেলা
      sb.from('chat_settings')
        .select('disappear_seconds')
        .eq('id', 1)
        .maybeSingle()
        .then(({ data }) => setDisappearSeconds((data as { disappear_seconds?: number } | null)?.disappear_seconds ?? 0));
      sb.rpc('purge_expired').then(({ data }) => {
        if (data?.length) removeImages(data as (string | null)[]);
      });
      clearNotifications();
      syncPush();

      await sb.realtime.setAuth(session.access_token);

      // ডাটাবেস পরিবর্তন: নতুন মেসেজ, seen, ডিলিট, প্রোফাইল
      dbChannel = sb
        .channel('db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
          const m = p.new as Message;
          setMessages((l) => merge(l, [m]));
          if (m.sender_id !== uid) {
            setPartnerTyping(false);
            if (document.visibilityState !== 'visible') notify(m);
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => {
          const n = p.new as Message;
          setMessages((l) => l.map((m) => (m.id === n.id ? { ...m, ...n } : m)));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
          const id = (p.old as { id?: string }).id;
          if (id) setMessages((l) => l.filter((m) => m.id !== id));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (p) => {
          if (p.eventType === 'DELETE') {
            const o = p.old as Partial<Reaction & { message_id: string }>;
            if (o.message_id && o.user_id) setMessages((l) => withReaction(l, o.message_id!, o.user_id!, null));
          } else {
            const n = p.new as Reaction & { message_id: string };
            setMessages((l) => withReaction(l, n.message_id, n.user_id, n.emoji));
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pinned_messages' }, (p) => {
          if (p.eventType === 'DELETE') {
            const id = (p.old as { message_id?: string }).message_id;
            if (id) setPins((l) => l.filter((x) => x.message_id !== id));
          } else loadPins();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_settings' }, (p) => {
          const n = p.new as { disappear_seconds: number; updated_by: string | null };
          setDisappearSeconds(n.disappear_seconds ?? 0);
          if (n.updated_by && n.updated_by !== uid) {
            const name = partnerRef.current?.display_name ?? 'অপর জন';
            setChatNotice({
              text: n.disappear_seconds
                ? `${name} মেসেজ নিজে মুছে যাওয়া চালু করেছেন: ${disappearLabel(n.disappear_seconds)}`
                : `${name} মেসেজ নিজে মুছে যাওয়া বন্ধ করেছেন`,
              at: Date.now(),
            });
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nudges' }, (p) => {
          const n = p.new as { id: string; sender_id: string };
          if (n.sender_id !== uid) setIncomingNudge({ id: n.id, at: Date.now() });
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
          const pr = p.new as Profile;
          if (pr.id === uid) {
            meRef.current = pr;
            setMe(pr);
          } else {
            partnerRef.current = pr;
            setPartner(pr);
          }
        })
        .subscribe((s) => {
          const ok = s === 'SUBSCRIBED';
          setConnected(ok);
          // সংযোগ ফিরে এলে মাঝখানে মিস হওয়া মেসেজ টেনে আনি
          if (ok && everSubscribed) loadLatest();
          if (ok) everSubscribed = true;
        });

      // প্রাইভেট রুম: অনলাইন স্ট্যাটাস (presence) + টাইপিং (broadcast)
      room = sb.channel(ROOM, {
        config: { private: true, presence: { key: uid }, broadcast: { self: false } },
      });
      roomRef.current = room;
      room
        .on('presence', { event: 'sync' }, () => {
          const state = room!.presenceState();
          const pid = partnerRef.current?.id;
          const online = !!pid && (state[pid]?.length ?? 0) > 0;
          setPartnerOnline(online);
          // অপর জন এইমাত্র অফলাইন হলেন — তার সর্বশেষ সময় সার্ভার থেকে নতুন করে আনি
          if (partnerWasOnline && !online && pid) {
            setTimeout(() => {
              sb.from('profiles')
                .select('id, display_name, avatar_url, last_seen')
                .eq('id', pid)
                .single()
                .then(({ data }) => {
                  if (!data || partnerRef.current?.id !== pid) return;
                  const next = { ...partnerRef.current, ...(data as Profile) };
                  partnerRef.current = next;
                  setPartner(next);
                });
            }, 1500);
          }
          partnerWasOnline = online;
        })
        .on('broadcast', { event: 'chat-cleared' }, ({ payload }) => {
          // অপর জন দুজনের কাছ থেকেই পুরো চ্যাট মুছেছেন
          if (payload?.user_id === uid) return;
          setMessages([]);
          setHasMore(false);
          setPins([]);
          setChatNotice({
            text: `${partnerRef.current?.display_name ?? 'অপর জন'} পুরো চ্যাট মুছে দিয়েছেন`,
            at: Date.now(),
          });
        })
        .on('broadcast', { event: 'force-logout' }, ({ payload }) => {
          // অন্য ডিভাইস থেকে "এই ডিভাইস লগআউট" চাপা হয়েছে
          const ids = (payload?.session_ids ?? []) as string[];
          if (mySession.current && ids.includes(mySession.current)) forceLogout();
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (!payload || payload.user_id === uid) return;
          const typing = !!payload.typing;
          setPartnerTyping(typing);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          if (typing) typingTimer.current = setTimeout(() => setPartnerTyping(false), 5000);
        })
        .subscribe(async (s) => {
          if (s === 'SUBSCRIBED' && document.visibilityState === 'visible') {
            // নতুন করে সংযোগ হলেও presence আবার জানাতে হয়
            active = false;
            goActive();
          }
        });

      touchLastSeen();
      heartbeat = setInterval(() => {
        if (!active) return;
        if (document.visibilityState !== 'visible' || Date.now() - lastInput > IDLE_MS) goAway();
        else touchLastSeen();
      }, 60_000);

      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', goAway);
      INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
      window.addEventListener('dujone-unlocked', markSeen);
    })();

    // টোকেন রিফ্রেশ হলে রিয়েলটাইমেও নতুন টোকেন দিই; লগআউট হলে লগইন পেইজে
    const { data: authSub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // নিজে লগআউট না করলে (টোকেন বাতিল হয়ে গেছে) — পরিষ্কার করে কারণসহ লগইন পেইজে
        if (!manualLogout.current) {
          manualLogout.current = true;
          clearLock();
          unsubscribeLocal();
          router.replace('/login?reason=revoked');
        } else router.replace('/login');
      }
      if (session) tokenRef.current = session.access_token;
      if (event === 'TOKEN_REFRESHED' && session) sb.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', goAway);
      INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInput));
      window.removeEventListener('dujone-unlocked', markSeen);
      if (heartbeat) clearInterval(heartbeat);
      if (dbChannel) sb.removeChannel(dbChannel);
      if (room) sb.removeChannel(room);
      roomRef.current = null;
    };
  }, [router, loadLatest, loadPins, markSeen, notify, touchLastSeen, updateTitle, validateSession, forceLogout]);

  // মেয়াদ শেষ হওয়া মেসেজ পর্দা থেকে সরানো (প্রতি ২০ সেকেন্ডে দেখে)
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (messagesRef.current.some((m) => m.expires_at && new Date(m.expires_at).getTime() <= now)) {
        setMessages((l) => l.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now));
      }
    };
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, []);

  // নতুন মেসেজ এলে (এবং পেইজ দেখা গেলে) seen মার্ক
  useEffect(() => {
    if (status === 'ready') markSeen();
  }, [messages, status, markSeen]);

  // ---------------------------------------------------------------- actions

  const deliver = useCallback(async (msg: Message) => {
    const sb = getSupabase();
    const setState = (patch: Partial<Message>) =>
      setMessages((l) => l.map((m) => (m.id === msg.id ? { ...m, ...patch } : m)));

    setState({ pending: true, failed: false });

    if (msg.image_path && msg.localFile) {
      const { error: upErr } = await sb.storage.from(IMAGE_BUCKET).upload(msg.image_path, msg.localFile, {
        contentType: msg.localFile.type || 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      });
      if (upErr) {
        console.error('ছবি আপলোড ব্যর্থ', upErr);
        setState({ pending: false, failed: true, errorText: explainError(upErr) });
        return;
      }
    }

    const { error } = await sb.from('messages').insert({
      id: msg.id,
      sender_id: msg.sender_id,
      content: msg.content,
      image_path: msg.image_path,
      reply_to: msg.reply_to ?? null,
    });
    // ২৩৫০৫ = আগেই পৌঁছে গেছে (আবার পাঠানোর সময়), সেটা সফল ধরি
    if (error && error.code !== '23505') {
      console.error('মেসেজ পাঠানো ব্যর্থ', error);
      setState({ pending: false, failed: true, errorText: explainError(error) });
      return;
    }
    setState({ pending: false, failed: false, errorText: undefined });
    // অপর পক্ষের ফোনে push (সার্ভার নিশ্চিত করে একই মেসেজে একবারই যাবে)
    notifyPartner(msg.id);
  }, []);

  const sendText = useCallback(
    (text: string, replyTo?: string | null) => {
      const uid = meRef.current?.id;
      const content = text.trim();
      if (!uid || !content) return;
      const msg: Message = {
        id: uuid(),
        sender_id: uid,
        content,
        image_path: null,
        created_at: new Date().toISOString(),
        seen_at: null,
        reply_to: replyTo ?? null,
        reactions: [],
        pending: true,
      };
      setMessages((l) => [...l, msg]);
      deliver(msg);
    },
    [deliver]
  );

  const sendImage = useCallback(
    async (file: File, replyTo?: string | null): Promise<string | null> => {
      const uid = meRef.current?.id;
      if (!uid) return null;
      if (!file.type.startsWith('image/')) return 'শুধু ছবি পাঠানো যাবে।';

      let blob: Blob;
      try {
        blob = await compressImage(file);
      } catch {
        return 'ছবিটি পড়া যায়নি। অন্য একটি ছবি চেষ্টা করুন।';
      }
      if (blob.size > MAX_IMAGE_BYTES) return 'ছবিটি ৫ MB-এর বেশি বড়।';

      const id = uuid();
      const msg: Message = {
        id,
        sender_id: uid,
        content: null,
        image_path: `${uid}/${id}.${extFor(blob)}`,
        created_at: new Date().toISOString(),
        seen_at: null,
        reply_to: replyTo ?? null,
        reactions: [],
        pending: true,
        localUrl: URL.createObjectURL(blob),
        localFile: blob,
      };
      setMessages((l) => [...l, msg]);
      deliver(msg);
      return null;
    },
    [deliver]
  );

  const retry = useCallback(
    (id: string) => {
      const msg = messagesRef.current.find((m) => m.id === id);
      if (msg?.failed) deliver(msg);
    },
    [deliver]
  );

  const deleteMessage = useCallback(async (id: string) => {
    const msg = messagesRef.current.find((m) => m.id === id);
    if (!msg) return;
    setMessages((l) => l.filter((m) => m.id !== id));
    if (msg.failed) return; // সার্ভারে পৌঁছায়নি, শুধু লোকাল থেকে মুছলেই হবে

    const sb = getSupabase();
    const { error } = await sb.from('messages').delete().eq('id', id);
    if (error) {
      setMessages((l) => merge(l, [msg]));
      alert('মেসেজটি মুছে ফেলা যায়নি। আবার চেষ্টা করুন।');
      return;
    }
    if (msg.image_path) await sb.storage.from(IMAGE_BUCKET).remove([msg.image_path]);
  }, []);

  /** "আমার কাছ থেকে মুছুন" — শুধু নিজের কাছে লুকায়, অপর জন দেখতে থাকেন */
  const hideMessage = useCallback(async (id: string) => {
    const msg = messagesRef.current.find((m) => m.id === id);
    if (!msg) return;
    setMessages((l) => l.filter((m) => m.id !== id));
    if (msg.failed || msg.pending) return;
    const { error } = await getSupabase().from('hidden_messages').insert({ message_id: id });
    if (error && error.code !== '23505') {
      console.error('লুকানো যায়নি', error);
      setMessages((l) => merge(l, [msg]));
      alert(`মেসেজটি মুছে ফেলা যায়নি। ${explainError(error)}`);
    }
  }, []);

  /** পুরো চ্যাট মোছা — 'me' = শুধু আমার কাছ থেকে, 'all' = দুজনের কাছ থেকেই */
  const clearChat = useCallback(async (scope: 'me' | 'all'): Promise<string | null> => {
    const uid = meRef.current?.id;
    if (!uid) return 'আবার লগইন করুন';
    const sb = getSupabase();
    if (scope === 'me') {
      const { error } = await sb.from('profiles').update({ cleared_before: new Date().toISOString() }).eq('id', uid);
      if (error) return explainError(error);
    } else {
      const { data, error } = await sb.rpc('clear_chat_all');
      if (error) return explainError(error);
      await removeImages((data ?? []) as (string | null)[]);
      roomRef.current?.send({ type: 'broadcast', event: 'chat-cleared', payload: { user_id: uid } });
    }
    setMessages([]);
    setHasMore(false);
    loadPins();
    return null;
  }, [loadPins]);

  /** নতুন মেসেজ কত সেকেন্ড পর মুছে যাবে (০ = বন্ধ) — দুজনের জন্যই */
  const updateDisappear = useCallback(async (seconds: number) => {
    const uid = meRef.current?.id;
    if (!uid) return 'আবার লগইন করুন';
    const before = disappearSeconds;
    setDisappearSeconds(seconds);
    const { error } = await getSupabase()
      .from('chat_settings')
      .update({ disappear_seconds: seconds, updated_by: uid, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) {
      setDisappearSeconds(before);
      return explainError(error);
    }
    return null;
  }, [disappearSeconds]);

  /** রিঅ্যাকশন দেওয়া / বদলানো; একই ইমোজি আবার দিলে সরে যায় */
  const react = useCallback(async (messageId: string, emoji: string) => {
    const uid = meRef.current?.id;
    const msg = messagesRef.current.find((m) => m.id === messageId);
    if (!uid || !msg || msg.pending || msg.failed) return;
    const current = msg.reactions?.find((r) => r.user_id === uid)?.emoji ?? null;
    const next = current === emoji ? null : emoji;

    setMessages((l) => withReaction(l, messageId, uid, next));
    const sb = getSupabase();
    const { error } = next
      ? await sb
          .from('message_reactions')
          .upsert({ message_id: messageId, user_id: uid, emoji: next }, { onConflict: 'message_id,user_id' })
      : await sb.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', uid);
    if (error) {
      setMessages((l) => withReaction(l, messageId, uid, current));
      return;
    }
    // অপর জনের মেসেজে নতুন রিঅ্যাকশন দিলে তার ফোনে খবর যায়
    if (next && msg.sender_id !== uid) notifyPartner(messageId, 'reaction');
  }, []);

  /** নিজের লেখা মেসেজ বদলানো */
  const editMessage = useCallback(async (id: string, text: string) => {
    const content = text.trim();
    const msg = messagesRef.current.find((m) => m.id === id);
    if (!msg || !content || content === msg.content) return;
    const before = { content: msg.content, edited_at: msg.edited_at ?? null };

    setMessages((l) => l.map((m) => (m.id === id ? { ...m, content, edited_at: new Date().toISOString() } : m)));
    const { error } = await getSupabase().from('messages').update({ content }).eq('id', id);
    if (error) {
      console.error('এডিট ব্যর্থ', error);
      setMessages((l) => l.map((m) => (m.id === id ? { ...m, ...before } : m)));
      alert(`মেসেজ এডিট করা যায়নি। ${explainError(error)}`);
    }
  }, []);

  // রিপ্লাই করা মূল মেসেজ তালিকায় না থাকলে (অনেক পুরোনো) আলাদা করে আনি
  useEffect(() => {
    if (status !== 'ready') return;
    const have = new Set(messages.map((m) => m.id));
    const missing = [
      ...new Set(messages.map((m) => m.reply_to).filter((id): id is string => !!id && !have.has(id) && !(id in quotes))),
    ];
    if (!missing.length) return;
    setQuotes((q) => ({ ...q, ...Object.fromEntries(missing.map((id) => [id, null])) }));
    getSupabase()
      .from('messages')
      .select('id, sender_id, content, image_path, created_at, seen_at')
      .in('id', missing)
      .then(({ data }) => {
        if (data?.length) setQuotes((q) => ({ ...q, ...Object.fromEntries((data as Message[]).map((m) => [m.id, m])) }));
      });
  }, [messages, quotes, status]);

  // ---------------------------------------------------------------- পিন
  const togglePin = useCallback(
    async (msg: Message) => {
      const uid = meRef.current?.id;
      if (!uid) return { ok: false, pinned: false };
      const sb = getSupabase();
      const isPinned = pins.some((p) => p.message_id === msg.id);
      if (isPinned) {
        setPins((l) => l.filter((p) => p.message_id !== msg.id));
        const { error } = await sb.from('pinned_messages').delete().eq('message_id', msg.id);
        if (error) loadPins();
        return { ok: !error, pinned: false };
      }
      setPins((l) => [{ message_id: msg.id, pinned_by: uid, pinned_at: new Date().toISOString(), message: msg }, ...l]);
      const { error } = await sb.from('pinned_messages').insert({ message_id: msg.id, pinned_by: uid });
      // ২৩৫০৫ = অপর জন একই সময়ে পিন করেছে — তাও ঠিক আছে
      if (error && error.code !== '23505') {
        console.error('পিন ব্যর্থ', error);
        loadPins();
        return { ok: false, pinned: false };
      }
      return { ok: true, pinned: true };
    },
    [pins, loadPins]
  );

  // ---------------------------------------------------------------- "মনে পড়ছে"
  /** 'ok' = পাঠানো হয়েছে, 'wait' = একটু আগেই পাঠানো হয়েছে, 'error' = সমস্যা */
  const sendNudge = useCallback(async (): Promise<'ok' | 'wait' | 'error'> => {
    const { data, error } = await getSupabase().from('nudges').insert({}).select('id').single();
    if (error) {
      if (error.code === '42501' || /row-level security/i.test(error.message)) return 'wait';
      console.error('"মনে পড়ছে" পাঠানো যায়নি', error);
      return 'error';
    }
    notifyPartner((data as { id: string }).id, 'nudge');
    return 'ok';
  }, []);

  // ---------------------------------------------------------------- খোঁজা
  /** পুরো চ্যাটে (সার্ভারে) লেখা খোঁজে — নতুনগুলো আগে, সর্বোচ্চ ৬০টি */
  const searchMessages = useCallback(async (q: string): Promise<Message[] | null> => {
    const term = q.trim();
    if (term.length < 2) return [];
    const pattern = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const { data, error } = await getSupabase()
      .from('messages')
      .select('id, sender_id, content, image_path, created_at, seen_at, edited_at')
      .ilike('content', pattern)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) {
      console.error('খোঁজা যায়নি', error);
      return null;
    }
    return (data ?? []) as Message[];
  }, []);

  /** কোনো পুরোনো মেসেজে যেতে হলে, সেটা পর্যন্ত মেসেজগুলো তালিকায় এনে রাখে */
  const ensureLoaded = useCallback(async (m: { id: string; created_at: string }) => {
    if (messagesRef.current.some((x) => x.id === m.id)) return true;
    const { data, error } = await getSupabase()
      .from('messages')
      .select(MSG_COLS)
      .gte('created_at', m.created_at)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error || !data) return false;
    setMessages((l) => merge(l, data as Message[]));
    return true;
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore) return;
    const oldest = messagesRef.current.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const { data } = await getSupabase()
      .from('messages')
      .select(MSG_COLS)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (data) {
      setMessages((l) => merge(l, data as Message[]));
      setHasMore(data.length === PAGE_SIZE);
    }
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [hasMore]);

  const lastTypingSent = useRef(0);
  const sendTyping = useCallback((typing: boolean) => {
    const room = roomRef.current;
    const uid = meRef.current?.id;
    if (!room || !uid) return;
    const now = Date.now();
    // "টাইপ করছে" সিগন্যাল প্রতি ২.৫ সেকেন্ডে সর্বোচ্চ একবার
    if (typing && now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = typing ? now : 0;
    room.send({ type: 'broadcast', event: 'typing', payload: { user_id: uid, typing } });
  }, []);

  const updateName = useCallback(async (name: string) => {
    const uid = meRef.current?.id;
    const display_name = name.trim().slice(0, 40);
    if (!uid || !display_name) return;
    const { data } = await getSupabase()
      .from('profiles')
      .update({ display_name })
      .eq('id', uid)
      .select('id, display_name, avatar_url, last_seen')
      .single();
    if (data) {
      meRef.current = data as Profile;
      setMe(data as Profile);
    }
  }, []);

  const logout = useCallback(async () => {
    manualLogout.current = true;
    touchLastSeen();
    // লগআউটের পর এই ডিভাইসে আর নোটিফিকেশন আসবে না, আর PIN লকও মুছে যায়
    await disablePush();
    clearLock();
    // শুধু এই ডিভাইস থেকে — অন্য ডিভাইসগুলো লগইন থাকে
    await getSupabase().auth.signOut({ scope: 'local' });
    router.replace('/login');
  }, [router, touchLastSeen]);

  /** অন্য ডিভাইসগুলোকে সাথে সাথে জানানো, যাতে খোলা থাকলেও তখনই লগআউট হয় */
  const kickSessions = useCallback((ids: string[]) => {
    if (!ids.length) return;
    roomRef.current?.send({ type: 'broadcast', event: 'force-logout', payload: { session_ids: ids } });
  }, []);

  return {
    status,
    errorText,
    me,
    partner,
    messages,
    hasMore,
    loadingOlder,
    partnerOnline,
    partnerTyping,
    connected,
    sendText,
    sendImage,
    retry,
    deleteMessage,
    react,
    editMessage,
    pins,
    togglePin,
    sendNudge,
    incomingNudge,
    hideMessage,
    clearChat,
    disappearSeconds,
    updateDisappear,
    chatNotice,
    searchMessages,
    ensureLoaded,
    quotes,
    loadError,
    loadOlder,
    sendTyping,
    updateName,
    logout,
    kickSessions,
    sessionId: mySession,
  };
}
