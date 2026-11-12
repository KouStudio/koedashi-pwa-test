'use strict';
// Bump VERSION for every shell change. Do not add APIs, licenses or media here.
const VERSION = 'koedashi-v2.4.0';
const PREFIX = 'sora-audio-shell:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'compat.js?v=ios-1',
  'engine.js?v=long-audio-1', 'app.js?v=ios-1',
  'pwa.css', 'pwa.js', 'manifest.webmanifest',
  'recorder.css', 'editor-bridge.js', 'recorder-core.js', 'recorder-ui.js', 'safe-data.js', 'pads-data.js', 'pad-player.js', 'pads-ui.js', 'pads.css', 'take-export.js', 'pad-drag.js', 'pad-volume.js', 'selection-controls.js', 'selection-controls.css', 'performance-view.js', 'simple.css',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
].map(path => new URL(path, self.registration.scope).href);
const ALLOWED = new Set(SHELL);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // No partial shell may activate. Errors leave the previous worker active.
    await cache.addAll(SHELL.map(url => new Request(url, {cache: 'reload'})));
  })());
  // No skipWaiting: never replace an editor while unsaved PCM is in memory.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
  })());
  // No clients.claim: switch only on a subsequent navigation.
});
self.addEventListener('fetch', event => {
  const r = event.request;
  // Exact URLs (including query) only. Do not intercept APIs, media, uploads,
  // authentication, Blob URLs, unknown navigations or Authorization requests.
  if (r.method !== 'GET' || r.headers.has('authorization') ||
      r.headers.has('range') || !ALLOWED.has(r.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(r);
    // Runtime responses are NEVER written to Cache Storage.
    return cached || fetch(r);
  })());
});
