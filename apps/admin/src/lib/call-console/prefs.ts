// This browser's calls preferences, per user: like a phone's silent switch, the ringer and the microphone belong to
// the device the agent sits at.
const key = (userId: string, name: string) => `multiwa:calls:${userId}:${name}`;
// Fired in this tab when the ringer is switched here; the browser's other tabs hear of it as a `storage` event.
const RINGER_SWITCHED = 'multiwa:calls:ringer';

export const prefs = {
  ringerMuted: (userId: string) => localStorage.getItem(key(userId, 'ringer')) === 'off',
  setRingerMuted: (userId: string, muted: boolean) => {
    localStorage.setItem(key(userId, 'ringer'), muted ? 'off' : 'on');
    window.dispatchEvent(new Event(RINGER_SWITCHED));
  },
  /** Calls `onSwitch` when the ringer may have been switched, in this tab or another (a useSyncExternalStore subscribe). */
  watchRinger: (onSwitch: () => void) => {
    window.addEventListener(RINGER_SWITCHED, onSwitch);
    window.addEventListener('storage', onSwitch);
    return () => {
      window.removeEventListener(RINGER_SWITCHED, onSwitch);
      window.removeEventListener('storage', onSwitch);
    };
  },
  /** The chosen microphone's deviceId (device ids are per site and per browser), if any. */
  mic: (userId: string) => localStorage.getItem(key(userId, 'mic')) || undefined,
  setMic: (userId: string, deviceId: string) => localStorage.setItem(key(userId, 'mic'), deviceId),
};
