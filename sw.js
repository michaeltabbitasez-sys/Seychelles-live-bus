self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => self.clients.claim());
// Network-first prototype: map tiles and live data require an internet connection.
