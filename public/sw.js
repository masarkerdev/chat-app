/* Dujone — service worker
 * - অ্যাপ ইনস্টলযোগ্য (PWA) করে
 * - স্ট্যাটিক ফাইল (JS/CSS/আইকন) ক্যাশ করে দ্রুত খোলার জন্য
 * - Web Push: অ্যাপ বন্ধ থাকলেও নতুন মেসেজের নোটিফিকেশন দেখায়
 * - নোটিফিকেশনে ট্যাপ করলে চ্যাট খুলে দেয়
 * মেসেজ বা Supabase রিকোয়েস্ট কখনো ক্যাশ করা হয় না।
 */
const CACHE = 'dujone-static-v6';
const TAG = 'dujone-message';
const IS_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------- ক্যাশ
self.addEventListener('fetch', (event) => {
  if (IS_DEV) return; // ডেভেলপমেন্টে ক্যাশ করলে পুরোনো কোড দেখাতে পারে
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // ভার্সনসহ স্ট্যাটিক ফাইল: cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // পেইজ: network-first, অফলাইনে আগের কপি
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/chat')))
    );
  }
});

// ---------------------------------------------------------------- Push
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      // চ্যাট এই মুহূর্তে স্ক্রিনে খোলা থাকলে নোটিফিকেশন লাগবে না
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const chatVisible = windows.some(
        (c) => c.visibilityState === 'visible' && new URL(c.url).pathname.startsWith('/chat')
      );
      if (chatVisible) return;

      const sender = data.title || 'Dujone';
      const body = data.body || 'নতুন মেসেজ';

      // রিঅ্যাকশন ও "মনে পড়ছে": আলাদা নোটিফিকেশন, মেসেজের সাথে জমা হয় না
      if (data.type === 'reaction' || data.type === 'nudge') {
        await self.registration.showNotification(sender, {
          body,
          tag: 'dujone-' + data.type,
          renotify: true,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          timestamp: Date.now(),
          data: { url: data.url || '/chat' },
        });
        return;
      }

      // একাধিক মেসেজ এলে একটিই নোটিফিকেশনে জমা হবে (শেষ ৫টি লাইন)
      const existing = await self.registration.getNotifications({ tag: TAG });
      const prev = existing.length ? existing[existing.length - 1].data || {} : {};
      const lines = [...(prev.lines || []), body].slice(-5);
      const count = (prev.count || 0) + 1;

      const title = count > 1 ? `${sender} (${count.toLocaleString('bn-BD')}টি নতুন মেসেজ)` : sender;

      await self.registration.showNotification(title, {
        body: count > 1 ? lines.join('\n') : body,
        tag: TAG,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        timestamp: Date.now(),
        data: { url: data.url || '/chat', lines, count },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/chat';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client && !new URL(client.url).pathname.startsWith('/chat')) {
            client.navigate(target).catch(() => {});
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
