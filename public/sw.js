// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Savvy Solution Pros LLC. Walk With Us — see NOTICE.
// Caches the app shell only. API responses are never cached (they're per-request and may be sensitive).
const V = "wwu-v9";
const SHELL = ["/", "/app.css", "/js/i18n.js", "/js/public.js", "/js/strings.js", "/icon.svg", "/manifest.webmanifest", "/privacy"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // The public schedule (/api/o/<slug>, GET) is public data: network-first, last copy kept for offline viewing.
  if (/^\/api\/o\/[a-z0-9-]+$/.test(u.pathname)) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)); } return r; })
      .catch(() => caches.match(e.request).then((m) => m || Response.json({ error: "offline" }, { status: 503 }))));
    return;
  }
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/c") || u.pathname.startsWith("/v")) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && SHELL.includes(u.pathname)) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});
