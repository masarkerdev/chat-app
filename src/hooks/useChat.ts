'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, IMAGE_BUCKET, PAGE_SIZE } from '@/lib/supabase';
import { compressImage, extFor } from '@/lib/image';
import { clearNotifications, disablePush, isPushActive, notifyPartner, syncPush } from '@/lib/push';
import type { Message, Profile } from '@/lib/types';

const ROOM = 'room:dujone';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BASE_TITLE = 'দুজনে';

type Status = 'loading' | 'ready' | 'not-member' | 'error';

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
        : m
    );
  }
  return [...map.values()].sort(byTime);
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

  const meRef = useRef<Profile | null>(null);
  const partnerRef = useRef<Profile | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const roomRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadHidden = useRef(0);
  const loadingOlderRef = useRef(false);

  messagesRef.current = messages;

  // ---------------------------------------------------------------- helpers

  const updateTitle = useCallback(() => {
    const n = unreadHidden.current;
    document.title = n > 0 ? `(${n.toLocaleString('bn-BD')}) ${BASE_TITLE}` : BASE_TITLE;
  }, []);

  const markSeen = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const uid = meRef.current?.id;
    if (!uid) return;
    const hasUnseen = messagesRef.current.some((m) => m.sender_id !== uid && !m.seen_at);
    if (!hasUnseen) return;
    if (seenTimer.current) clearTimeout(seenTimer.current);
    seenTimer.current = setTimeout(() => {
      getSupabase().rpc('mark_seen').then(() => {});
    }, 350);
  }, []);

  const touchLastSeen = useCallback(() => {
    const uid = meRef.current?.id;
    if (!uid) return;
    getSupabase()
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', uid)
      .then(() => {});
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

  const loadLatest = useCallback(async (initial = false) => {
    const { data, error } = await getSupabase()
      .from('messages')
      .select('id, sender_id, content, image_path, created_at, seen_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error || !data) return;
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

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        unreadHidden.current = 0;
        updateTitle();
        clearNotifications();
        room?.track({ online_at: new Date().toISOString() });
        loadLatest();
        markSeen();
        touchLastSeen();
      } else {
        room?.untrack();
        touchLastSeen();
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
          setPartnerOnline(!!pid && (state[pid]?.length ?? 0) > 0);
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
            await room!.track({ online_at: new Date().toISOString() });
          }
        });

      touchLastSeen();
      heartbeat = setInterval(() => {
        if (document.visibilityState === 'visible') touchLastSeen();
      }, 60_000);

      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', touchLastSeen);
    })();

    // টোকেন রিফ্রেশ হলে রিয়েলটাইমেও নতুন টোকেন দিই; লগআউট হলে লগইন পেইজে
    const { data: authSub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
      if (event === 'TOKEN_REFRESHED' && session) sb.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', touchLastSeen);
      if (heartbeat) clearInterval(heartbeat);
      if (dbChannel) sb.removeChannel(dbChannel);
      if (room) sb.removeChannel(room);
      roomRef.current = null;
    };
  }, [router, loadLatest, markSeen, notify, touchLastSeen, updateTitle]);

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
        setState({ pending: false, failed: true });
        return;
      }
    }

    const { error } = await sb.from('messages').insert({
      id: msg.id,
      sender_id: msg.sender_id,
      content: msg.content,
      image_path: msg.image_path,
    });
    // ২৩৫০৫ = আগেই পৌঁছে গেছে (আবার পাঠানোর সময়), সেটা সফল ধরি
    if (error && error.code !== '23505') {
      setState({ pending: false, failed: true });
      return;
    }
    setState({ pending: false, failed: false });
    // অপর পক্ষের ফোনে push (সার্ভার নিশ্চিত করে একই মেসেজে একবারই যাবে)
    notifyPartner(msg.id);
  }, []);

  const sendText = useCallback(
    (text: string) => {
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
        pending: true,
      };
      setMessages((l) => [...l, msg]);
      deliver(msg);
    },
    [deliver]
  );

  const sendImage = useCallback(
    async (file: File): Promise<string | null> => {
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

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore) return;
    const oldest = messagesRef.current.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const { data } = await getSupabase()
      .from('messages')
      .select('id, sender_id, content, image_path, created_at, seen_at')
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
    touchLastSeen();
    // লগআউটের পর এই ডিভাইসে আর নোটিফিকেশন আসবে না
    await disablePush();
    await getSupabase().auth.signOut();
    router.replace('/login');
  }, [router, touchLastSeen]);

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
    loadOlder,
    sendTyping,
    updateName,
    logout,
  };
}
