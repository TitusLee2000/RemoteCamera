// ===== RemoteCamera Service Worker =====
// Handles Web Push notifications from the server.
// Registered by dashboard/app.js at startup.

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'RemoteCamera Alert', {
      body: data.body ?? 'Object detected',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.slotId ? `alert-${data.slotId}` : 'alert',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/'))
})
