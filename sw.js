/* sw.js — offline cache-first. Bump VERSION on every release. */
'use strict';
var VERSION = 'docvi-v7';
var ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/boot.js', 'js/rules.js', 'js/audio.js', 'js/fx.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/be-vietnam-pro-latin-700-normal.woff2', 'fonts/be-vietnam-pro-vietnamese-700-normal.woff2',
  'fonts/be-vietnam-pro-latin-800-normal.woff2', 'fonts/be-vietnam-pro-vietnamese-800-normal.woff2',
  'fonts/be-vietnam-pro-latin-900-normal.woff2', 'fonts/be-vietnam-pro-vietnamese-900-normal.woff2',
  'fonts/jetbrains-mono-latin-500-normal.woff2', 'fonts/jetbrains-mono-vietnamese-500-normal.woff2',
  'fonts/jetbrains-mono-latin-700-normal.woff2', 'fonts/jetbrains-mono-vietnamese-700-normal.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k.indexOf('docvi-') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return c.match('index.html');
        return Response.error();
      });
    });
  }));
});
