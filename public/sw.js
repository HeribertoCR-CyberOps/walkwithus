// Caches the app shell only. API responses are never cached (they're per-request and may be sensitive).
const V = "wwu-v1";
const SHELL = ["/", "/index.html", "/app.css", "/js/i18n.js", "/js/public.js", "/icon.svg", "/manifest.webmanifest", "/privacy.html"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/c") || u.pathname.startsWith("/v")) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && SHELL.includes(u.pathname)) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});
