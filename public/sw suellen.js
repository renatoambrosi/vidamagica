/* ── Service Worker — Suellen Push Notifications ── */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Vida Mágica', {
      body:  data.body || 'Nova mensagem',
      icon:  '/assets/icon-192.png',
      badge: '/assets/icon-72.png',
      data:  data.data || {},
      vibrate: [200, 100, 200],
      tag: 'vm-chat',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/suellen';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/suellen') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
