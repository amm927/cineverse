// ==========================================================================
// CineVerse AI — Service Worker con Web Push Notifications + Caché Offline
// ==========================================================================

// VitePWA inyectará aquí el precache manifest de los assets estáticos
const PRECACHE_ASSETS = self.__WB_MANIFEST || [];

const CACHE_NAME = 'cineverse-v1';
const OFFLINE_URLS = ['/'];

// --- Instalación: pre-cachear shell de la app ---
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker CineVerse...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cachear assets estáticos del manifest + shell
      const urlsToCache = [...OFFLINE_URLS, ...PRECACHE_ASSETS.map(e => e.url || e)];
      return cache.addAll(urlsToCache).catch(() => cache.addAll(OFFLINE_URLS));
    })
  );
  self.skipWaiting();
});


// --- Activación: limpiar cachés antiguas ---
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando Service Worker CineVerse...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// --- Fetch: estrategia Network-First con fallback a caché ---
self.addEventListener('fetch', (event) => {
  // Solo interceptar GETs del mismo origen
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  // No interceptar WebSockets ni llamadas a la API del backend
  if (event.request.url.includes('/api/') || event.request.url.includes('/ws/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clonar y guardar en caché si es válida
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback a caché si falla la red
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});

// ==========================================================================
// 🔔 WEB PUSH NOTIFICATIONS — Listener principal
// ==========================================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Evento push recibido:', event);

  let payload = {
    title: '🍿 ¡CineVerse!',
    body: 'Tienes un nuevo match con tu pareja.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: {}
  };

  // Intentar parsear el payload del servidor
  if (event.data) {
    try {
      const serverData = event.data.json();
      payload = {
        title: serverData.title || payload.title,
        body: serverData.body || payload.body,
        icon: serverData.icon || payload.icon,
        badge: '/pwa-192x192.png',
        data: serverData.data || {}
      };
    } catch (err) {
      // Si no es JSON, usar el texto directamente como body
      payload.body = event.data.text();
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: 'cinematch-match',              // Agrupa notificaciones del mismo tipo
    renotify: true,                       // Vibrar/sonar aunque ya haya una con el mismo tag
    vibrate: [200, 100, 200, 100, 400],  // Patrón de vibración: match celebration
    data: {
      url: '/',                           // URL a abrir al tocar la notificación
      ...payload.data
    },
    actions: [
      {
        action: 'open',
        title: '🎬 Ver Matches',
        icon: '/pwa-192x192.png'
      },
      {
        action: 'dismiss',
        title: 'Cerrar'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

// --- Manejar click en la notificación push ---
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Click en notificación:', event.action, event.notification.data);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta, enfocarla y navegar
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      // Si no hay ventana, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// --- Notificación cerrada por el usuario ---
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notificación cerrada:', event.notification.tag);
});
