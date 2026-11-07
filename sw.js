// Офлайн-режим: всё складываем в кэш при установке, отдаём из кэша и тихо обновляем из сети.
// Новая версия сайта — поменяй VERSION, старый кэш удалится.
const VERSION = 'verstak-46';
const FILES = [
  './',
  'app.js',
  'blocks.js',
  'cheats/brew.js',
  'cheats/potions.js',
  'cheats/redstone-scenes.js',
  'cheats/redstone.js',
  'cheats/tips.js',
  'cheats/villagers.js',
  'engine.js',
  'farms/bamboo.js',
  'farms/breeder.js',
  'farms/cane.js',
  'farms/curing.js',
  'farms/index.js',
  'store.js',
  'farms/iron.js',
  'farms/melon.js',
  'farms/tree.js',
  'mech/hopperclock.js',
  'mech/gand.js',
  'mech/gnand.js',
  'mech/gnor.js',
  'mech/gnot.js',
  'mech/gor.js',
  'mech/gxor.js',
  'mech/index.js',
  'mech/obsclock.js',
  'mech/power.js',
  'fonts/golos-text-cyrillic-400-normal.woff2',
  'fonts/golos-text-cyrillic-500-normal.woff2',
  'fonts/golos-text-cyrillic-600-normal.woff2',
  'fonts/golos-text-cyrillic-700-normal.woff2',
  'fonts/golos-text-latin-400-normal.woff2',
  'fonts/golos-text-latin-500-normal.woff2',
  'fonts/golos-text-latin-600-normal.woff2',
  'fonts/golos-text-latin-700-normal.woff2',
  'fonts/tiny5-cyrillic-400-normal.woff2',
  'fonts/tiny5-latin-400-normal.woff2',
  'icons.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'index.html',
  'manifest.webmanifest',
  'vendor/three/addons/controls/OrbitControls.js',
  'vendor/three/three.module.js',
];
self.addEventListener('install', e => {
  // мимо HTTP-кэша браузера: GitHub Pages просит хранить файлы 10 минут, и без этого в новую версию попал бы старый файл
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
