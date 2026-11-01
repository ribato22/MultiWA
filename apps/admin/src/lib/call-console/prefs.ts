// This browser's calls preferences, per user: like a phone's silent switch, the ringer and the microphone belong to
// the device the agent sits at.
const key = (userId: string, name: string) => `multiwa:calls:${userId}:${name}`;

export const prefs = {
  ringerMuted: (userId: string) => localStorage.getItem(key(userId, 'ringer')) === 'off',
  setRingerMuted: (userId: string, muted: boolean) => localStorage.setItem(key(userId, 'ringer'), muted ? 'off' : 'on'),
  /** The chosen microphone's deviceId (device ids are per site and per browser), if any. */
  mic: (userId: string) => localStorage.getItem(key(userId, 'mic')) || undefined,
  setMic: (userId: string, deviceId: string) => localStorage.setItem(key(userId, 'mic'), deviceId),
};
