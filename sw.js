const CACHE = "fill-assistant-v2-production-1";
const ASSETS = ["./","./index.html","./styles.css","./data.js","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];

self.addEventListener("install", e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e=>{
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
});
