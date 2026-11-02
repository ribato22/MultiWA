// Stand-ins installed in every page before its own scripts (context.addInitScript): what the tests read or steer.
// It runs inside the page, so it is self-contained.
export function installBrowserFakes() {
  const w = window as any;
  // Desktop alerts: recorded instead of shown. `__notificationPermission` steers the permission ('granted' by default);
  // `__notificationThrows` makes the constructor throw, as Chrome on Android does (only a service worker shows one).
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
      if (w.__notificationThrows) throw new TypeError('Illegal constructor');
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
  // A tab the browser keeps silent (the config lets every tab sound): `__audioBlocked = true`, set before the first ring
  // (the page makes its AudioContext then), reads `suspended` until a resume() inside a trusted click or key with the
  // user's activation runs it, 20 ms later. Inside: Playwright's own evaluations count as a user gesture too, so the
  // activation alone is no click. `__audioRunsIn = ms`: one that runs by itself that long after it was made, as Firefox
  // starts one suspended.
  const NativeAudioContext = AudioContext;
  w.AudioContext = class extends NativeAudioContext {
    held = !!w.__audioBlocked || w.__audioRunsIn !== undefined;
    constructor(...args: any[]) {
      super(...(args as [AudioContextOptions?]));
      if (w.__audioRunsIn !== undefined) setTimeout(() => this.run(), w.__audioRunsIn);
    }
    get state(): AudioContextState {
      return this.held ? 'suspended' : super.state;
    }
    resume() {
      const input = window.event?.isTrusted && /^(click|key|mouse|pointer|touch)/.test(window.event.type);
      if (this.held && input && navigator.userActivation.isActive) setTimeout(() => this.run(), 20);
      return super.resume();
    }
    run() {
      this.held = false;
      this.dispatchEvent(new Event('statechange'));
    }
  };
  // The console's socket: `__socketOpen()` is false once the page has seen its connection drop (the close event has run),
  // and true again once it reconnected.
  const NativeWebSocket = WebSocket;
  const sockets: WebSocket[] = [];
  w.WebSocket = class extends NativeWebSocket {
    constructor(...args: any[]) {
      super(...(args as [string | URL, (string | string[])?]));
      if (String(args[0]).includes('/socket.io/')) sockets.push(this);
    }
  };
  w.__socketOpen = () => sockets.some((s) => s.readyState === NativeWebSocket.OPEN || s.readyState === NativeWebSocket.CLOSING);
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
