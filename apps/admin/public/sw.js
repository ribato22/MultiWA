// MultiWA Push Notification Service Worker
// This file runs in the browser's service worker context

self.addEventListener("push", function (event) {
  console.log("[SW] Push event received!");

  if (!event.data) {
    console.log("[SW] Push event has no data");
    return;
  }

  try {
    const data = event.data.json();
    console.log("[SW] Push data:", JSON.stringify(data));

    const title = data.title || "MultiWA";
    const options = {
      body: data.body || "",
      icon: data.icon || "/favicon.png",
      badge: data.badge || "/favicon.png",
      data: data.data || {},
      timestamp: data.timestamp || Date.now(),
      tag: data.tag || "multiwa-notification-" + Date.now(),
      renotify: true,
      requireInteraction: false,
      // Add vibration for mobile
      vibrate: [200, 100, 200],
    };

    event.waitUntil(
      self.registration
        .showNotification(title, options)
        .then(() => console.log("[SW] Notification shown successfully"))
        .catch((err) =>
          console.error("[SW] Failed to show notification:", err),
        ),
    );
  } catch (err) {
    console.error("[SW] Error parsing push data:", err);
    // Fallback for non-JSON payloads
    event.waitUntil(
      self.registration.showNotification("MultiWA", {
        body: event.data.text(),
        icon: "/favicon.png",
      }),
    );
  }
});

self.addEventListener("notificationclick", function (event) {
  console.log("[SW] Notification clicked");
  event.notification.close();

  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // Focus existing window if open
        for (const client of clientList) {
          if (client.url.includes("/dashboard") && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
  );
});

// Handle service worker activation
self.addEventListener("activate", function (event) {
  console.log("[SW] Service Worker activated");
  event.waitUntil(clients.claim());
});

// Handle service worker installation
self.addEventListener("install", function (event) {
  console.log("[SW] Service Worker installed");
  self.skipWaiting();
});

// Handle subscription change (e.g., VAPID key rotation, browser expiry)
self.addEventListener("pushsubscriptionchange", function (event) {
  console.log("[SW] Push subscription changed, attempting re-subscribe");
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options || { userVisibleOnly: true })
      .then(function (newSub) {
        console.log("[SW] Re-subscribed successfully");
        // Notify the server about the new subscription
        return fetch("/api/notifications/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub.toJSON()),
        });
      })
      .catch(function (err) {
        console.error("[SW] Re-subscribe failed:", err);
      }),
  );
});
