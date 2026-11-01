// Stand-ins installed in every page before its own scripts (context.addInitScript): what the tests read or steer.
// It runs inside the page, so it is self-contained.
export function installBrowserFakes() {
  const w = window as any;
  // Desktop alerts: recorded instead of shown. `__notificationPermission` steers the permission ('granted' by default).
  w.__notifications = [];
  w.Notification = class {
    static get permission() {
      return w.__notificationPermission ?? 'granted';
    }
    static async requestPermission() {
      w.__notificationPermission = 'granted';
      return 'granted';
    }
    onclick: (() => void) | null = null;
    closed = false;
    constructor(public title: string, public options: NotificationOptions = {}) {
      w.__notifications.push(this);
    }
    close() {
      this.closed = true;
    }
  };
  // Whether the tab is hidden, steered by the test: `__setHidden(true)`.
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  w.__setHidden = (h: boolean) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  // Tones: every oscillator started (the ringer's, the speaker test's).
  w.__tones = 0;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (this: OscillatorNode, ...args: any[]) {
    w.__tones++;
    return (start as any).apply(this, args);
  };
  // Peer connections: the tests read the microphone's sender (mute, a switched microphone).
  w.__pcs = [];
  const Native = RTCPeerConnection;
  w.RTCPeerConnection = class extends Native {
    constructor(...args: any[]) {
      super(...(args as [RTCConfiguration?]));
      w.__pcs.push(this);
    }
  };
}
