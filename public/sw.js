self.addEventListener('push', (event) => {
  let data = { title: 'PhonePair', body: 'Something new arrived', url: '/' }
  try { data = { ...data, ...(event.data ? event.data.json() : {}) } } catch { /* keep the default */ }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(clients.openWindow(url))
})
