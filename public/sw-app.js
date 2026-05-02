/* ── Service Worker — App Vida Mágica (aluna) ──
   Notificações push pra aluna saber quando a Suellen falar com ela. */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Vida Mágica', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Vida Mágica', {
      body:     data.body || 'A Suellen falou com você ✨',
      icon:     '/assets/icon-192.png',
      badge:    '/assets/icon-72.png',
      data:     data.data || {},
      vibrate:  [200, 100, 200],
      tag:      'vm-aluna',
      renotify: true,
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se a aluna já tem o app aberto, foca ele
      for (const client of clientList) {
        if (client.url.includes('/app') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
