const CACHE_NAME = "grammar-sprint-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./resit/",
  "./styles.css",
  "./data.js",
  "./app.js",
  "./icon.svg",
  "./apple-touch-icon.png",
  "./icon-512.png",
  "./manifest.webmanifest",
  "./Grammar%20BM%20-%20Complete%20Exam%20Guide.pdf",
  "./Grammar%20BM%20-%20Last-Minute%20Guide.pdf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  // Pages and the resit trainer: network first so updates arrive immediately, cache as offline fallback.
  if (event.request.mode === "navigate" || new URL(event.request.url).pathname.includes("/resit/")) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }))
  );
});
