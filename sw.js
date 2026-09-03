// Service worker : précache du shell pour le hors-ligne, mais réseau d'abord
// quand la connexion est là — sinon un appareil installé reste bloqué sur
// l'ancienne version. Incrémenter CACHE_NAME à chaque déploiement.
const CACHE_NAME = 'cookbook-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // `reload` contourne le cache HTTP : sans ça l'hébergeur peut resservir
      // les anciens fichiers au moment même où l'on précache la nouvelle version.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        // Hors-ligne : on sert le cache, et le shell pour toute navigation.
        const cached = await cache.match(request)
          ?? (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
        if (cached) return cached;
        throw error;
      }
    })
  );
});
