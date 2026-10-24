// Service worker: rede primeiro, com cache de reserva do casco do app (e requisito para instalar como PWA).
// Requisições ao Firebase (outros domínios) nunca passam pelo cache.
const VERSAO = "loja-v10";
const BASE = [
  "./", "index.html", "acompanhar.html", "css/style.css",
  "js/db.js", "js/store.js", "js/acompanhar.js", "js/pwa.js",
  "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // painel administrativo sempre direto da rede
  if (url.pathname.endsWith("/admin.html") || url.pathname.endsWith("/admin.js") || url.pathname.endsWith("/admin.css")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
