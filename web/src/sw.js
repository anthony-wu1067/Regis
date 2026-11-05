/* Offline + update strategy: network first (so a new release is picked up the next time you open Regis while online),
   cached copy when offline. __VERSION__ is stamped in at build time; a new version replaces the old cache. */
var VERSION = '__VERSION__', CACHE = 'regis-' + VERSION, FILES = __FILES__;
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE && k.indexOf('regis-') === 0; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.search.indexOf('code=') >= 0) return;                         // sign-in redirects always go to the network
  e.respondWith(
    fetch(r, { cache: 'no-cache' }).then(function (res) { if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); } return res; })
      .catch(function () { return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); }); }));
});
