/* Pedidos · Frutos da Roça — service worker: a "casca" do app abre sem internet; dados (Supabase) nunca vão para o cache */
'use strict';
var VERSION = 'pedidos-fr-v1.0.1';
var FILES = ['./', './index.html', './manifest.webmanifest', './assets/app.css', './assets/config.js', './assets/fotos.js', './assets/sb.js', './assets/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/logo-frutos-da-roca.png', './icons/folhas.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf('pedidos-fr-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url); if (url.origin !== location.origin) return;
  if (/\/setup\.html$|\.sql$/.test(url.pathname)) return;   // página de ativar o banco e o .sql: sempre direto da rede
  if (/\/assets\/produtos\//.test(url.pathname)) {   // fotos: cache conforme usa
    e.respondWith(caches.open(VERSION).then(function (c) { return c.match(req).then(function (hit) { return hit || fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; }); }); }));
    return;
  }
  // app: rede primeiro (pega versão nova), cache se estiver sem internet
  e.respondWith(fetch(req).then(function (r) { if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); } return r; })
    .catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); }); }));
});
