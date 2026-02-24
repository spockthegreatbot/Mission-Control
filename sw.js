// Mission Control Service Worker
// Version 1.0.0

const CACHE_NAME = 'mission-control-v1';
const OFFLINE_CACHE = 'mission-control-offline-v1';

// Static resources to cache
const STATIC_RESOURCES = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
];

// API routes that should be cached for offline use
const API_CACHE_ROUTES = [
    '/mc/status',
    '/mc/data',
    '/mc/system',
    '/mc/activity'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static resources');
                return cache.addAll(STATIC_RESOURCES);
            })
            .then(() => {
                console.log('[SW] Installation complete');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Installation failed:', error);
            })
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(cacheName => 
                            cacheName !== CACHE_NAME && 
                            cacheName !== OFFLINE_CACHE
                        )
                        .map(cacheName => {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activation complete');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip cross-origin requests (except fonts)
    if (url.origin !== location.origin && !url.hostname.includes('googleapis')) {
        return;
    }
    
    event.respondWith(
        handleFetch(request)
    );
});

// Handle fetch requests with caching strategy
async function handleFetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    try {
        // Strategy 1: Network first for API routes (with cache fallback)
        if (pathname.startsWith('/mc/')) {
            return await networkFirstStrategy(request);
        }
        
        // Strategy 2: Cache first for static resources
        if (STATIC_RESOURCES.includes(pathname) || pathname === '/') {
            return await cacheFirstStrategy(request);
        }
        
        // Strategy 3: Network first for everything else
        return await networkFirstStrategy(request);
        
    } catch (error) {
        console.error('[SW] Fetch error:', error);
        
        // Return offline page for navigation requests
        if (request.destination === 'document') {
            return createOfflinePage();
        }
        
        // Return empty response for other requests
        return new Response('', { status: 408, statusText: 'Offline' });
    }
}

// Cache first strategy - serve from cache, update in background
async function cacheFirstStrategy(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        // Serve from cache and update in background
        fetchAndCache(request, cache);
        return cachedResponse;
    }
    
    // Not in cache, fetch and cache
    const response = await fetch(request);
    if (response.ok) {
        cache.put(request, response.clone());
    }
    
    return response;
}

// Network first strategy - try network, fallback to cache
async function networkFirstStrategy(request) {
    try {
        const response = await fetch(request);
        
        if (response.ok) {
            // Cache successful responses
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        // Network failed, try cache
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        throw error;
    }
}

// Background fetch and cache update
async function fetchAndCache(request, cache) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
    } catch (error) {
        console.log('[SW] Background fetch failed:', error);
    }
}

// Create offline page
function createOfflinePage() {
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Mission Control - Offline</title>
            <style>
                body {
                    font-family: 'Inter', sans-serif;
                    background: #050508;
                    color: #ffffff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                }
                .offline-container {
                    text-align: center;
                    max-width: 400px;
                    padding: 2rem;
                }
                .offline-icon {
                    font-size: 4rem;
                    margin-bottom: 1rem;
                }
                h1 {
                    font-size: 1.5rem;
                    margin-bottom: 1rem;
                    color: #6C63FF;
                }
                p {
                    color: #cccccc;
                    margin-bottom: 1.5rem;
                    line-height: 1.6;
                }
                .retry-btn {
                    background: #6C63FF;
                    color: white;
                    border: none;
                    padding: 0.75rem 1.5rem;
                    border-radius: 8px;
                    font-size: 1rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .retry-btn:hover {
                    background: #5a52e0;
                }
            </style>
        </head>
        <body>
            <div class="offline-container">
                <div class="offline-icon">📡</div>
                <h1>You're Offline</h1>
                <p>Mission Control is temporarily unavailable. Some features may still work with cached data.</p>
                <button class="retry-btn" onclick="window.location.reload()">
                    Retry Connection
                </button>
            </div>
        </body>
        </html>
    `;
    
    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
}

// Background sync for when connection is restored
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync') {
        console.log('[SW] Background sync triggered');
        event.waitUntil(doBackgroundSync());
    }
});

// Perform background sync operations
async function doBackgroundSync() {
    try {
        // Sync any pending data when connection is restored
        const pendingData = await getStoredData('pendingSync');
        if (pendingData && pendingData.length > 0) {
            for (const item of pendingData) {
                try {
                    await fetch(item.url, item.options);
                } catch (error) {
                    console.error('[SW] Sync failed for item:', item, error);
                }
            }
            // Clear synced data
            await clearStoredData('pendingSync');
        }
    } catch (error) {
        console.error('[SW] Background sync failed:', error);
    }
}

// Push notifications
self.addEventListener('push', event => {
    console.log('[SW] Push received:', event);
    
    const options = {
        body: event.data ? event.data.text() : 'New update from Mission Control',
        icon: '/favicon.png',
        badge: '/favicon.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'open',
                title: 'Open Mission Control',
                icon: '/favicon.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/favicon.png'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Mission Control', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    console.log('[SW] Notification clicked:', event);
    
    event.notification.close();
    
    if (event.action === 'open') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Handle notification close
self.addEventListener('notificationclose', event => {
    console.log('[SW] Notification closed:', event);
});

// Message handler for communication with main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type) {
        switch (event.data.type) {
            case 'SKIP_WAITING':
                self.skipWaiting();
                break;
            case 'GET_VERSION':
                event.ports[0].postMessage({ version: CACHE_NAME });
                break;
            case 'CACHE_UPDATE':
                event.waitUntil(updateCache());
                break;
        }
    }
});

// Update cache manually
async function updateCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const requests = STATIC_RESOURCES.map(url => new Request(url));
        
        for (const request of requests) {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    await cache.put(request, response);
                }
            } catch (error) {
                console.error('[SW] Failed to update cache for:', request.url, error);
            }
        }
        
        console.log('[SW] Cache updated successfully');
    } catch (error) {
        console.error('[SW] Cache update failed:', error);
    }
}

// Utility functions for IndexedDB storage
async function getStoredData(key) {
    // Simplified storage - in a real implementation you'd use IndexedDB
    return null;
}

async function clearStoredData(key) {
    // Simplified storage - in a real implementation you'd use IndexedDB
    return true;
}

console.log('[SW] Service Worker loaded');