const CACHE_NAME = 'dreamvault-v2.0';
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://cdn.tailwindcss.com'
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching static resources');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('Service worker installed successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('Service worker installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service worker activated successfully');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip external domains (but allow CDN resources)
  const url = new URL(event.request.url);
  const isExternalCDN = url.hostname.includes('unpkg.com') || 
                       url.hostname.includes('cdn.tailwindcss.com') ||
                       url.hostname.includes('images.unsplash.com');
  
  if (!event.request.url.startsWith(self.location.origin) && !isExternalCDN) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Serve from cache
          console.log('Serving from cache:', event.request.url);
          return cachedResponse;
        }

        // Fallback to network
        console.log('Fetching from network:', event.request.url);
        return fetch(event.request)
          .then((response) => {
            // Check if valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            // Cache the response for future use
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch((error) => {
            console.error('Network fetch failed:', error);
            // Offline fallback
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
            
            // Return a custom offline response for other requests
            return new Response('Offline content not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Background sync for offline dream saves
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync-dreams') {
    event.waitUntil(syncDreams());
  } else if (event.tag === 'periodic-sync') {
    event.waitUntil(periodicSync());
  }
});

// Periodic background sync
self.addEventListener('periodicsync', (event) => {
  console.log('Periodic sync triggered:', event.tag);
  
  if (event.tag === 'dream-reminder') {
    event.waitUntil(sendDreamReminder());
  }
});

// Push notifications for dream reminders
self.addEventListener('push', (event) => {
  console.log('Push notification received');
  
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'DreamVault Reminder 🌙';
  const options = {
    body: data.body || 'Time to record your dreams! What did you dream about last night?',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'dream-reminder',
    data: data.url || '/',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Open App',
        icon: '/favicon.ico'
      },
      {
        action: 'snooze',
        title: 'Remind Later',
        icon: '/favicon.ico'
      },
      {
        action: 'dismiss', 
        title: 'Dismiss'
      }
    ],
    vibrate: [200, 100, 200],
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.action);
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    // Open the app
    event.waitUntil(
      clients.matchAll({ type: 'window' })
        .then((clientList) => {
          // If app is already open, focus it
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          // Otherwise, open new window
          if (clients.openWindow) {
            return clients.openWindow(event.notification.data || '/');
          }
        })
    );
  } else if (event.action === 'snooze') {
    // Schedule a new notification for later
    event.waitUntil(scheduleSnoozeNotification());
  }
  // For 'dismiss', just close (already handled above)
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification.tag);
  // Could track analytics here
});

// Message handling for communication with main app
self.addEventListener('message', (event) => {
  console.log('Service worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CACHE_DREAM') {
    // Cache a dream for offline access
    event.waitUntil(cacheDreamOffline(event.data.dream));
  } else if (event.data && event.data.type === 'SCHEDULE_REMINDER') {
    // Schedule a dream reminder
    event.waitUntil(scheduleReminder(event.data.time));
  }
});

// Helper functions

async function syncDreams() {
  try {
    console.log('Syncing dreams in background...');
    
    // Get offline dreams from IndexedDB
    const offlineDreams = await getOfflineDreams();
    
    if (offlineDreams.length > 0) {
      // Sync with server (when you have a backend)
      console.log(`Found ${offlineDreams.length} offline dreams to sync`);
      
      // For now, just log - replace with actual API calls later
      for (const dream of offlineDreams) {
        console.log('Would sync dream:', dream.title);
      }
      
      // Clear offline dreams after successful sync
      await clearOfflineDreams();
    }
    
    console.log('Dream sync completed');
  } catch (error) {
    console.error('Dream sync failed:', error);
  }
}

async function periodicSync() {
  try {
    console.log('Performing periodic sync...');
    
    // Update app data in background
    await updateCachedContent();
    
    // Check for new features or content
    await checkForUpdates();
    
    console.log('Periodic sync completed');
  } catch (error) {
    console.error('Periodic sync failed:', error);
  }
}

async function sendDreamReminder() {
  try {
    console.log('Sending dream reminder...');
    
    // Check if user has already recorded a dream today
    const hasRecordedToday = await checkTodaysDream();
    
    if (!hasRecordedToday) {
      await self.registration.showNotification('Dream Reminder 🌙', {
        body: 'Don\'t forget to record your dreams! Keep your streak going!',
        icon: '/favicon.ico',
        tag: 'daily-reminder',
        requireInteraction: false,
        actions: [
          { action: 'open', title: 'Open App' },
          { action: 'dismiss', title: 'Later' }
        ]
      });
    }
  } catch (error) {
    console.error('Failed to send dream reminder:', error);
  }
}

async function scheduleSnoozeNotification() {
  // Schedule notification for 1 hour later
  setTimeout(() => {
    self.registration.showNotification('Dream Reminder 🌙', {
      body: 'Gentle reminder to record your dreams when you\'re ready!',
      icon: '/favicon.ico',
      tag: 'snooze-reminder'
    });
  }, 60 * 60 * 1000); // 1 hour
}

async function cacheDreamOffline(dream) {
  // Store dream offline for later sync
  console.log('Caching dream offline:', dream.title);
  // Implementation would use IndexedDB
}

async function scheduleReminder(time) {
  // Schedule a push notification reminder
  console.log('Scheduling reminder for:', time);
  // Implementation would use actual push notification scheduling
}

async function getOfflineDreams() {
  // Get dreams stored offline
  return []; // Placeholder - would use IndexedDB
}

async function clearOfflineDreams() {
  // Clear offline dreams after sync
  console.log('Clearing offline dreams');
}

async function updateCachedContent() {
  // Update cached content
  console.log('Updating cached content');
}

async function checkForUpdates() {
  // Check for app updates
  console.log('Checking for updates');
}

async function checkTodaysDream() {
  // Check if user recorded a dream today
  return false; // Placeholder
}

// Error handling
self.addEventListener('error', (event) => {
  console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service worker unhandled rejection:', event.reason);
});

console.log('Service Worker script loaded successfully');
