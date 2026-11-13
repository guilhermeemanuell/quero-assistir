const CACHE = "quero-assistir-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    const cached = request.mode === "navigate"
      ? (await cache.match("./index.html")) || (await cache.match(request))
      : await cache.match(request, { ignoreSearch: true });

    const networkFetch = fetch(request, { cache: "no-store" }).then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
        if (request.mode === "navigate") {
          cache.put("./index.html", response.clone());
        }
      }
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(networkFetch);
      return cached;
    }

    const response = await networkFetch;
    return response || (await cache.match("./index.html"));
  })());
});