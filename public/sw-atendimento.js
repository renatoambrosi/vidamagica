/* ── Service Worker — Atendimento Vida Mágica ──
   Notificações push para o painel /atendimento.
   Substitui o antigo sw suellen.js (que tinha espaço no nome — bug). */

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
      body:     data.body || 'Nova mensagem',
      icon:     '/assets/icon-192.png',
      badge:    '/assets/icon-72.png',
      data:     data.data || {},
      vibrate:  [200, 100, 200],
      tag:      'vm-atendimento',
      renotify: true,
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/atendimento';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já tem aba aberta no /atendimento, foca nela
      for (const client of clientList) {
        if (client.url.includes('/atendimento') && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre nova
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
