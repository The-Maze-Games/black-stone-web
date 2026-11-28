// Sin conexión: guarda la app entera la primera vez. Con red, siempre sirve lo nuevo;
// lo guardado sólo sale si no hay red, así nunca se mezclan archivos de dos versiones.
const VERSION = "bs-34";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/main.js", "js/engine.js", "js/i18n.js", "js/chamber.js", "js/reference.js", "js/db.js", "js/util.js",
  "fonts/Cinzel-Variable.woff2", "fonts/Alegreya-Variable.woff2", "fonts/Alegreya-Italic.woff2",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "db/index.json", "db/search.json", "db/tables.json", "db/chambers.json", "db/conditions.json",
  "db/creatures.json", "db/items.json", "db/materials.json", "db/rules.json",
  "data/table-a.json", "data/table-b.json", "data/table-c.json", "data/table-d.json",
  "data/table-3-1.json", "data/table-3-2.json", "data/table-3-2-spark.json", "data/table-3-2-wall.json",
  "data/table-3-3.json", "data/table-3-4.json", "data/table-3-5.json", "data/table-3-6.json", "data/table-3-7.json",
  "data/table-3-8.json", "data/table-3-9.json", "data/table-3-10.json",
  "data/table-4-1.json", "data/table-4-2.json", "data/table-4-3.json", "data/table-4-4.json", "data/table-4-5.json",
  "data/table-4-6.json", "data/table-4-7.json", "data/table-4-8.json", "data/table-4-9.json",
  "data/bestiary.json", "data/agnostic.json",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero la red (sin la caché del navegador); si falla, lo guardado. Con señal débil la red
// puede colgarse: si tarda más de WAIT ms y hay copia guardada, sale la copia y la respuesta
// de la red, cuando llegue, sólo actualiza lo guardado para la próxima vez. Tras una espera así,
// durante un rato se sirve lo guardado sin esperar, para no sumar una espera por cada archivo.
const WAIT = 3500, SLOW_FOR = 60000;
let slowUntil = 0;
self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET" || new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(caches.open(VERSION).then(async (cache) => {
    const net = fetch(ev.request, { cache: "no-cache" }).then((res) => {
      if (res.ok) cache.put(ev.request, res.clone());
      return res;
    });
    ev.waitUntil(net.catch(() => {}));
    const hit = await cache.match(ev.request, { ignoreSearch: true });
    if (!hit) return net;
    if (Date.now() < slowUntil) return hit;
    let timer;
    const late = new Promise((ok) => { timer = setTimeout(() => { slowUntil = Date.now() + SLOW_FOR; ok(hit); }, WAIT); });
    try { const res = await Promise.race([net, late]); return res.ok ? res : hit; }
    catch { return hit; }
    finally { clearTimeout(timer); }
  }));
});
