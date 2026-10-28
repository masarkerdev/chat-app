'use client';

import { useChat } from '@/hooks/useChat';
import { usePush } from '@/hooks/usePush';
import { PushBanner } from '@/components/PushBanner';
import { ChatHeader } from '@/components/ChatHeader';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { getSupabase } from '@/lib/supabase';

export default function ChatPage() {
  const chat = useChat();
  const push = usePush();

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

      {!chat.connected && <div className="conn-banner">সংযোগ বিচ্ছিন্ন — আবার যুক্ত হওয়ার চেষ্টা চলছে…</div>}

      <MessageList
        messages={chat.messages}
        meId={me.id}
        hasMore={chat.hasMore}
        loadingOlder={chat.loadingOlder}
        typing={chat.partnerTyping}
        onLoadOlder={chat.loadOlder}
        onDelete={chat.deleteMessage}
        onRetry={chat.retry}
      />

      <Composer onSend={chat.sendText} onImage={chat.sendImage} onTyping={chat.sendTyping} />
    </main>
  );
}
