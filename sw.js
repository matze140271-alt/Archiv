/* Offline-Speicher der App: alle Programmdateien werden auf dem iPhone zwischengespeichert. */
const VERSION = "archiv-1.0.1";
const FILES = [
  "./",
  "analyse.js",
  "app.js",
  "db.js",
  "deu.traineddata.gz",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "jspdf.umd.min.js",
  "jszip.min.js",
  "manifest.json",
  "pdf.min.js",
  "pdf.worker.min.js",
  "scan.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract.min.js",
  "worker.min.js",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
