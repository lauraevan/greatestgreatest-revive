/* greatestgreatest service worker — makes repeat loads near-instant.
 * Strategy: stale-while-revalidate for the site's OWN shell only. Games hosted
 * on other repos / CDNs are never intercepted, so nothing about play changes.
 * Bump VERSION to force old caches out. */
const VERSION = "gg-cache-v12";

// Everything the SW manages lives under the folder this sw.js is served from
// (e.g. /<user>/<repo>/main/). Games on other paths/origins pass straight through.
const BASE = self.location.pathname.replace(/sw\.js$/, "");

const CORE = [
  BASE,
  BASE + "index.html",
  BASE + "games-data.js",
  BASE + "games-noicon.js",
  BASE + "links.html",
  BASE + "manifest.webmanifest",
  BASE + "icons/app-192.png",
  BASE + "icons/app-512.png",
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then(cache =>
      // cache each individually so one failure can't abort the whole install
      Promise.all(CORE.map(url => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only manage our own same-origin shell files. Let games / CDNs load normally.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // The page shell + the game lists change often, so fetch those FRESH first
    // (falling back to cache when offline) — this way new games/features show up
    // on the very next load instead of a reload later. Everything else (icons,
    // static assets) stays cache-first for instant repeat loads.
    const fresh = req.mode === "navigate" ||
                  /\/(index\.html)?$/.test(url.pathname) ||
                  /(games-data|games-noicon)\.js$/.test(url.pathname);
    if (fresh) {
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    }
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    // serve cache instantly if we have it; the network copy refreshes it in the background
    return cached || network;
  })());
});
