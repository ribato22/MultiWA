// How a ringing call gets attention in this tab: the ringtone (Web Audio; one tab of the browser rings), the title
// flash, and a desktop alert while the tab is in the background. Also the speaker test of Settings → Calls.
let ctx: AudioContext | null = null;

/** Makes or resumes the page's AudioContext; inside a click or a key press the browser lets it sound from then on. */
export function unlockAudio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Two tones, like a desk phone, every 3 s. One tab of the browser rings (a Web Lock); the agent's others stay quiet. */
export function startRinging(onBlocked: (blocked: boolean) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let release: (() => void) | undefined;
  const ring = () => {
    const ac = unlockAudio();
    // Without a click since the page loaded, the browser keeps the context suspended: the banner asks for one.
    onBlocked(ac.state !== 'running');
    if (ac.state !== 'running') return;
    const t = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    for (const at of [0, 0.6]) {
      gain.gain.setValueAtTime(0.12, t + at);
      gain.gain.setValueAtTime(0, t + at + 0.4);
    }
    gain.connect(ac.destination);
    for (const hz of [440, 480]) {
      const osc = ac.createOscillator();
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 1);
    }
  };
  const onGesture = () => unlockAudio();
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
  const run = () => {
    ring();
    timer = setInterval(ring, 3000);
  };
  if (navigator.locks) {
    void navigator.locks.request('multiwa-call-ringer', { ifAvailable: true }, (lock) => {
      if (!lock || stopped) return undefined;
      run();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
  } else run();
  return () => {
    stopped = true;
    clearInterval(timer);
    release?.();
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
}

/** Alternates the tab's title with `text` every second, until stop() puts the page's own title back. */
export function flashTitle(text: string): () => void {
  let title = document.title;
  const timer = setInterval(() => {
    if (document.title === text) document.title = title;
    else {
      title = document.title; // the page may have changed its title meanwhile
      document.title = text;
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    if (document.title === text) document.title = title;
  };
}

/** A desktop alert while the tab is in the background, when the agent allowed them; a click brings the tab forward. */
export function desktopAlert(title: string, body: string, tag: string): () => void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState !== 'hidden') return () => undefined;
  const n = new Notification(title, { body, tag, requireInteraction: true });
  n.onclick = () => {
    window.focus();
    n.close();
  };
  return () => n.close();
}

/** Settings → Calls: one short tone, to check the speaker. */
export function playTestTone(): void {
  const ac = unlockAudio();
  const t = ac.currentTime;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  gain.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.frequency.value = 660;
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.8);
}
