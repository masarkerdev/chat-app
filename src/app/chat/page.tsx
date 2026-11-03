'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { usePush } from '@/hooks/usePush';
import { PushBanner } from '@/components/PushBanner';
import { ChatHeader } from '@/components/ChatHeader';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { getSupabase } from '@/lib/supabase';
import { AppLockGate } from '@/components/AppLock';
import { SearchPanel } from '@/components/SearchPanel';
import { PinBar } from '@/components/PinBar';
import { NudgeLayer } from '@/components/NudgeLayer';
import { ClearChatDialog } from '@/components/ClearChatDialog';
import { DisappearDialog } from '@/components/DisappearDialog';
import { TimerIcon } from '@/components/Icons';
import { disappearLabel, snippet } from '@/lib/format';
import type { Message } from '@/lib/types';

export default function ChatPage() {
  return (
    <AppLockGate>
      <ChatScreen />
    </AppLockGate>
  );
}

function ChatScreen() {
  const chat = useChat();
  const push = usePush();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const cancelReply = useCallback(() => setReplyTo(null), []);
  const cancelEdit = useCallback(() => setEditing(null), []);
  // রিপ্লাই আর এডিট একসাথে চলে না
  const startReply = useCallback((m: Message) => {
    setEditing(null);
    setReplyTo(m);
  }, []);
  const startEdit = useCallback((m: Message) => {
    setReplyTo(null);
    setEditing(m);
  }, []);

  const [searchOpen, setSearchOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [disappearOpen, setDisappearOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const [jumpRequest, setJumpRequest] = useState<{ id: string; key: number } | null>(null);
  const [nudgeTrigger, setNudgeTrigger] = useState<number | null>(null);
  const [nudgeText, setNudgeText] = useState('');
  const [nudgeSub, setNudgeSub] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const { ensureLoaded, incomingNudge, partner, chatNotice } = chat;

  // অপর জন চ্যাট মুছলে বা টাইমার বদলালে জানাই
  useEffect(() => {
    if (chatNotice) showToast(chatNotice.text);
  }, [chatNotice, showToast]);

  /** খোঁজা বা পিন থেকে কোনো মেসেজে যাওয়া — পুরোনো হলে আগে লোড করে নেয় */
  const jumpToMessage = useCallback(
    async (m: { id: string; created_at: string }) => {
      const ok = await ensureLoaded(m);
      if (!ok) return showToast('মেসেজটি লোড করা যায়নি');
      setJumpRequest({ id: m.id, key: Date.now() });
    },
    [ensureLoaded, showToast]
  );

  // অপর জন "মনে পড়ছে" পাঠালে হৃদয় ভাসে
  useEffect(() => {
    if (!incomingNudge) return;
    // যিনি পাচ্ছেন তার নাম দিয়ে: "I love you মাহফুজ ❤️"
    setNudgeText(`I love you ${chat.me?.display_name ?? ''} ❤️`.replace('  ', ' '));
    setNudgeSub('');
    setNudgeTrigger(incomingNudge.at);
  }, [incomingNudge, partner, chat.me]);

  const pinnedIds = useMemo(() => new Set(chat.pins.map((p) => p.message_id)), [chat.pins]);
  const byId = useMemo(() => new Map(chat.messages.map((m) => [m.id, m])), [chat.messages]);

  if (chat.status === 'loading') {
    return (
      <main className="splash">
        <span className="spinner spinner-dark" aria-label="লোড হচ্ছে" />
      </main>
    );
  }

  if (chat.status === 'not-member' || chat.status === 'error') {
    return (
      <main className="splash">
        <div className="notice">
          <h2>{chat.status === 'not-member' ? 'আপনি এই চ্যাটের সদস্য নন' : 'কিছু একটা সমস্যা হয়েছে'}</h2>
          <p className="muted">
            {chat.status === 'not-member'
              ? 'এই চ্যাটে শুধু দুইজন নির্দিষ্ট ব্যক্তি ঢুকতে পারেন।'
              : chat.errorText || 'পরে আবার চেষ্টা করুন।'}
          </p>
          <button
            className="primary-btn"
            onClick={async () => {
              await getSupabase().auth.signOut();
              location.href = '/login';
            }}
          >
            লগইন পেইজে ফিরুন
          </button>
        </div>
      </main>
    );
  }

  const me = chat.me!;
  const partnerName = chat.partner?.display_name ?? 'অপর জন';

  const send = (text: string) => {
    if (editing) {
      chat.editMessage(editing.id, text);
      setEditing(null);
      return;
    }
    chat.sendText(text, replyTo?.id);
    setReplyTo(null);
  };
  const sendImage = async (file: File) => {
    const err = await chat.sendImage(file, replyTo?.id);
    if (!err) setReplyTo(null);
    return err;
  };

  return (
    <main className="chat">
      <ChatHeader
        me={me}
        partner={chat.partner}
        online={chat.partnerOnline}
        typing={chat.partnerTyping}
        connected={chat.connected}
        push={push}
        onRename={chat.updateName}
        onLogout={chat.logout}
        onKickSessions={chat.kickSessions}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenDisappear={() => setDisappearOpen(true)}
        onOpenClear={() => setClearOpen(true)}
        onNudge={async () => {
          const r = await chat.sendNudge();
          if (r === 'ok') {
            setNudgeText(`I love you ${partnerName} ❤️`);
            setNudgeSub(`${partnerName}-কে পাঠানো হলো`);
            setNudgeTrigger(Date.now());
          } else if (r === 'wait') showToast('একটু আগেই পাঠিয়েছেন, কয়েক সেকেন্ড পর আবার চাপুন');
          else showToast('পাঠানো যায়নি, ইন্টারনেট দেখে আবার চেষ্টা করুন');
        }}
      />

      <PushBanner push={push} />
      <PinBar pins={chat.pins} byId={byId} onJump={jumpToMessage} />
      {chat.disappearSeconds > 0 && (
        <button className="disappear-bar" onClick={() => setDisappearOpen(true)}>
          <TimerIcon size={16} />
          নতুন মেসেজ {disappearLabel(chat.disappearSeconds)} পর নিজে মুছে যাবে
        </button>
      )}

      {!chat.connected && <div className="conn-banner">সংযোগ বিচ্ছিন্ন। আবার যুক্ত হওয়ার চেষ্টা চলছে…</div>}
      {chat.loadError && (
        <div className="conn-banner" role="alert">
          মেসেজ লোড করা যায়নি। {chat.loadError}
        </div>
      )}

      <MessageList
        messages={chat.messages}
        meId={me.id}
        hasMore={chat.hasMore}
        loadingOlder={chat.loadingOlder}
        typing={chat.partnerTyping}
        partnerName={partnerName}
        quotes={chat.quotes}
        pinnedIds={pinnedIds}
        jumpRequest={jumpRequest}
        onLoadOlder={chat.loadOlder}
        onDelete={chat.deleteMessage}
        onHide={chat.hideMessage}
        onRetry={chat.retry}
        onReply={startReply}
        onEdit={startEdit}
        onTogglePin={async (m) => {
          const r = await chat.togglePin(m);
          if (!r.ok) showToast('পিন করা যায়নি, আবার চেষ্টা করুন');
          else showToast(r.pinned ? '📌 পিন করা হলো, দুজনেই উপরে দেখবেন' : 'পিন সরানো হলো');
        }}
        onReact={chat.react}
      />

      <Composer
        reply={
          replyTo
            ? { name: partnerName, text: snippet(replyTo, 120), byMe: replyTo.sender_id === me.id }
            : null
        }
        onCancelReply={cancelReply}
        editing={editing ? { text: editing.content ?? '' } : null}
        onCancelEdit={cancelEdit}
        onSend={send}
        onImage={sendImage}
        onTyping={chat.sendTyping}
      />

      {searchOpen && (
        <SearchPanel
          meId={me.id}
          partnerName={partnerName}
          onSearch={chat.searchMessages}
          onClose={closeSearch}
          onPick={(m) => {
            setSearchOpen(false);
            jumpToMessage(m);
          }}
        />
      )}

      {clearOpen && (
        <ClearChatDialog partnerName={partnerName} onClear={chat.clearChat} onClose={() => setClearOpen(false)} />
      )}
      {disappearOpen && (
        <DisappearDialog
          current={chat.disappearSeconds}
          partnerName={partnerName}
          onSave={chat.updateDisappear}
          onClose={() => setDisappearOpen(false)}
        />
      )}

      <NudgeLayer trigger={nudgeTrigger} message={nudgeText} sub={nudgeSub} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
