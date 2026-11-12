const CACHE = "quero-assistir-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(key =>
        (key.startsWith("quero-assistir-") || key.startsWith("minha-colecao-")) &&
        key !== CACHE
      )
      .map(key => caches.delete(key))
    )
  ));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  const appShell = [
    "./",
    "./index.html",
    "./app.js",
    "./styles.css",
    "./manifest.webmanifest"
  ].some(path => new URL(path, self.location.href).pathname === url.pathname);

  if (appShell) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match(request)) || caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith(caches.match(request).then(cached =>
    cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match("./index.html"))
  ));
});
