const CACHE = "fill-assistant-v3-no-negative";
const ASSETS = ["./","./index.html","./styles.css","./data.js","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener("fetch", e=>{
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
});
