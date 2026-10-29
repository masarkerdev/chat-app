'use client';

import { useCallback, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { usePush } from '@/hooks/usePush';
import { PushBanner } from '@/components/PushBanner';
import { ChatHeader } from '@/components/ChatHeader';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { getSupabase } from '@/lib/supabase';
import { AppLockGate } from '@/components/AppLock';
import { snippet } from '@/lib/format';
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
      />

      <PushBanner push={push} />

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
        onLoadOlder={chat.loadOlder}
        onDelete={chat.deleteMessage}
        onRetry={chat.retry}
        onReply={startReply}
        onEdit={startEdit}
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
    </main>
  );
}
