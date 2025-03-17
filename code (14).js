// sw.js (Service Worker - Advanced)

const CACHE_NAME = 'advanced-browser-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/index.js',
    '/manifest.json',
    '/icon.png', // Assuming you have a 192x192 icon
    // Add any other static assets (fonts, images, etc.)
];

self.addEventListener('install', event => {
    console.log('[Service Worker] Installing Service Worker ...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Precaching App Shell');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[Service Worker] Skip waiting on install');
                return self.skipWaiting(); // Force the new SW to become active immediately
            })
    );
});

self.addEventListener('activate', event => {
    console.log('[Service Worker] Activating Service Worker ....');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => {
            return self.clients.claim(); // Take control of all clients immediately
        })
    );
});


self.addEventListener('fetch', event => {
    // Ignore requests that are not GET
    if (event.request.method !== 'GET') {
      return;
    }
    //Ignore requests to chrome extension
    if (event.request.url.startsWith('chrome-extension')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // 1. Cache Hit: Return the cached response immediately.
                if (cachedResponse) {
                    console.log('[Service Worker] Fetching from cache:', event.request.url);

                    //  Update the cache in the background (Stale-While-Revalidate)
                    fetch(event.request)
                        .then(fetchResponse => {
                            if (!fetchResponse || fetchResponse.status !== 200) { // Don't cache bad responses
                               return;
                            }
                            return caches.open(CACHE_NAME)
                                .then(cache => {
                                    console.log('[Service Worker] Updating cache for:', event.request.url);
                                    cache.put(event.request, fetchResponse.clone());
                                });
                        }).catch(err=> console.warn("Failed to update cache:", err))

                    return cachedResponse;
                }

                // 2. Cache Miss: Fetch from network, cache the response, and return it.
                console.log('[Service Worker] Fetching from network:', event.request.url);
                return fetch(event.request)
                    .then(fetchResponse => {
                        // Check for valid response
                        if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
                            return fetchResponse; // Don't cache if invalid
                        }

                        const responseToCache = fetchResponse.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {
                                console.log('[Service Worker] Caching new resource:', event.request.url);
                                cache.put(event.request, responseToCache);
                            });

                        return fetchResponse;
                    })
                    .catch(error => {
                        // OFFLINE:  If the network fetch fails (and it wasn't in the cache),
                        // you could return a custom offline page here.
                        console.error('[Service Worker] Network fetch failed:', error);
                        // Example: return caches.match('/offline.html');
                        return new Response('<h1>Offline</h1><p>You are currently offline.</p>', {
                            headers: { 'Content-Type': 'text/html' }
                        });
                    });
            })
    );
});

// Listen for messages from the client (e.g., to force a cache update)
self.addEventListener('message', event => {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});