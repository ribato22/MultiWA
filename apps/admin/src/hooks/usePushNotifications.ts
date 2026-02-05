'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    permission: 'unsupported',
    isSubscribed: false,
    isLoading: true,
    error: null,
  });
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Check support and current state on mount
  useEffect(() => {
    const init = async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

      if (!supported) {
        setState(prev => ({ ...prev, isSupported: false, isLoading: false, permission: 'unsupported' }));
        return;
      }

      try {
        // Register service worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        registrationRef.current = registration;

        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;

        // Check BROWSER-side subscription (the real source of truth)
        const browserSub = await registration.pushManager.getSubscription();
        const browserHasSubscription = !!browserSub;

        // Check SERVER-side subscription
        let serverHasSubscription = false;
        try {
          const { data } = await api.getPushSubscriptions();
          serverHasSubscription = data?.hasSubscription || false;
        } catch {
          // Server check failed, rely on browser state
        }

        // If server thinks we're subscribed but browser isn't, the subscription is stale
        // Clean up by marking as unsubscribed
        const isSubscribed = browserHasSubscription && Notification.permission === 'granted';

        if (serverHasSubscription && !browserHasSubscription) {
          console.warn('[Push] Server has subscription but browser does not — stale subscription detected');
        }

        setState({
          isSupported: true,
          permission: Notification.permission,
          isSubscribed,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        console.error('[Push] Init failed:', err);
        setState(prev => ({
          ...prev,
          isSupported: true,
          permission: Notification.permission,
          isLoading: false,
          error: null, // Don't show error on init
        }));
      }
    };

    init();
  }, []);

  const subscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Step 1: Request notification permission from the browser
      const permission = await Notification.requestPermission();
      console.log('[Push] Permission result:', permission);

      if (permission !== 'granted') {
        setState(prev => ({
          ...prev,
          permission,
          isLoading: false,
          error: permission === 'denied'
            ? 'Notifications are blocked. Please allow notifications in your browser settings and try again.'
            : 'Notification permission was dismissed. Please try again.',
        }));
        return false;
      }

      // Step 2: Get VAPID public key from server
      const { data: vapidData } = await api.getVapidPublicKey();
      console.log('[Push] VAPID key received:', vapidData?.publicKey ? 'yes' : 'no');

      if (!vapidData?.publicKey) {
        setState(prev => ({ ...prev, isLoading: false, error: 'Push notification server not configured. Contact admin.' }));
        return false;
      }

      // Step 3: Create browser push subscription
      const registration = registrationRef.current || await navigator.serviceWorker.ready;

      // Unsubscribe from any existing subscription first (clean slate)
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
        console.log('[Push] Removed stale browser subscription');
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey) as BufferSource,
      });
      console.log('[Push] Browser subscription created:', subscription.endpoint.substring(0, 60));

      // Step 4: Send subscription to server
      const subJson = subscription.toJSON();
      await api.subscribePush({
        endpoint: subJson.endpoint!,
        keys: {
          p256dh: subJson.keys!.p256dh!,
          auth: subJson.keys!.auth!,
        },
      });
      console.log('[Push] Server subscription saved');

      // Step 5: Verify subscription was created successfully
      const verifySub = await registration.pushManager.getSubscription();
      if (!verifySub) {
        console.warn('[Push] Subscription was not persisted by the browser');
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Browser did not persist the push subscription. Try restarting your browser.',
        }));
        return false;
      }
      console.log('[Push] Subscription verified ✓');

      setState(prev => ({
        ...prev,
        permission: 'granted',
        isSubscribed: true,
        isLoading: false,
        error: null,
      }));

      return true;
    } catch (err: any) {
      console.error('[Push] Subscribe failed:', err);
      let errorMsg = err.message || 'Failed to subscribe to push notifications';

      // Provide helpful error messages
      if (err.name === 'NotAllowedError') {
        errorMsg = 'Notifications are blocked. Please allow notifications in your browser settings.';
      } else if (err.name === 'AbortError') {
        errorMsg = 'Subscription was cancelled. Please try again.';
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = registrationRef.current || await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe from server
        await api.unsubscribePush(subscription.endpoint);
        // Unsubscribe from browser
        await subscription.unsubscribe();
      }

      setState(prev => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null,
      }));

      return true;
    } catch (err: any) {
      console.error('[Push] Unsubscribe failed:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Failed to unsubscribe',
      }));
      return false;
    }
  }, []);

  const testPush = useCallback(async () => {
    try {
      const { data } = await api.testPush();
      return data;
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    testPush,
  };
}

/**
 * Convert a Base64 URL-encoded string to a Uint8Array (for applicationServerKey)
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
