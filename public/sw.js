const CACHE = "lakshmi-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.includes("supabase")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put("/", copy)); return response; }).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone())); return response; })));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const open = clients.find(client => "focus" in client);
    return open ? open.focus() : self.clients.openWindow("/");
  }));
});
