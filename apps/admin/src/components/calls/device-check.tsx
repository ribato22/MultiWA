'use client';
// Settings → Calls: this browser's microphone and speaker, checked before a call, and how a call gets attention here
// (the ringer, desktop alerts). The choices belong to this browser, per user.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Mic, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currentUser } from '@/lib/current-user';
import { micProblem } from '@/lib/calls';
import { playTestTone } from '@/lib/call-console/attention';
import { prefs } from '@/lib/call-console/prefs';

const PERMISSION_TEXT = {
  granted: 'Allowed',
  denied: 'Blocked: allow the microphone in the browser’s site settings',
  prompt: 'Not asked yet: test the microphone to allow it',
  unknown: 'Not known yet: test the microphone to check it',
} as const;

export function DeviceCheck() {
  const [me] = useState(currentUser);
  // The microphone and desktop alerts need HTTPS. The speaker test and the ringer do not: calls ring on plain HTTP too.
  const [secure] = useState(() => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia);
  const [permission, setPermission] = useState<keyof typeof PERMISSION_TEXT>('unknown');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState(() => (me ? prefs.mic(me.id) ?? '' : ''));
  // The microphone chosen here, as a test still opening reads it once the browser has opened one.
  const picked = useRef(mic);
  // The microphone a test opened: the browser picks one itself while it lists none to choose from (Firefox and Safari,
  // until the microphone is allowed).
  const [opened, setOpened] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The ringer as switched here or in another tab.
  const ringerMuted = useSyncExternalStore(prefs.watchRinger, () => !!me && prefs.ringerMuted(me.id), () => false);
  const [alerts, setAlerts] = useState<string>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const stopTest = useRef<(() => void) | null>(null);
  // A test whose microphone is still opening (the browser may be asking the agent): a second click starts no second one.
  const starting = useRef(false);
  // Whether this check is still on the page: a microphone that opens once the agent left is closed at once.
  const alive = useRef(false);
  const listMics = () =>
    navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)), () => undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopTest.current?.();
    };
  }, []);
  useEffect(() => {
    if (!secure) return;
    let status: PermissionStatus | undefined;
    // Firefox cannot query the microphone permission: it reads "not known yet" until a test.
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(
      (s) => {
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      },
      () => undefined,
    );
    void listMics();
    // A microphone plugged in or out changes the list.
    const media = navigator.mediaDevices;
    media.addEventListener('devicechange', listMics);
    return () => {
      if (status) status.onchange = null;
      media.removeEventListener('devicechange', listMics);
    };
  }, [secure]);

  if (!me) return null;

  // The microphone to test, as the list shows it: the one a test opened, else the one chosen here, while this browser
  // has them (a headset may be unplugged since); else the first one.
  const chosen = [opened, mic].find((id) => mics.some((m) => m.deviceId === id)) ?? mics[0]?.deviceId;
  const test = async () => {
    if (stopTest.current) return stopTest.current();
    if (starting.current) return;
    starting.current = true;
    const pick = picked.current;
    setProblem(null);
    const tracks: MediaStreamTrack[] = [];
    const close = () => tracks.forEach((t) => t.stop());
    try {
      // A listed microphone exactly. One the browser does not list yet is asked for as a call asks for it.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: chosen ? { deviceId: { exact: chosen } } : mic ? { deviceId: { ideal: mic } } : true,
      });
      tracks.push(...stream.getTracks());
      // Opened for nothing: the agent left the page while the browser asked (nothing would ever stop it), or picked
      // another microphone meanwhile (a pick stops a test: the next one opens the pick).
      if (!alive.current || picked.current !== pick) return close();
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let frame = 0;
      let shown = 0;
      let last = performance.now();
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
        const now = performance.now();
        // The meter falls back slowly, from full to nothing in about a second: a voice's peaks stay readable.
        shown = Math.max(Math.min(100, Math.round(rms * 300)), Math.round(shown - (now - last) / 10));
        last = now;
        setLevel(shown);
        frame = requestAnimationFrame(tick);
      };
      tick();
      setTesting(true);
      setPermission('granted');
      setOpened(stream.getAudioTracks()[0]?.getSettings().deviceId ?? null);
      void listMics(); // their names show once the microphone is allowed
      stopTest.current = () => {
        cancelAnimationFrame(frame);
        close();
        void ctx.close();
        setTesting(false);
        setLevel(0);
        stopTest.current = null;
      };
    } catch (e) {
      close(); // opened, but the meter could not start
      setProblem(micProblem(e));
    } finally {
      starting.current = false;
    }
  };

  return (
    <section aria-label="Calls in this browser" className="space-y-6 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Calls in this browser</h2>
        <p className="text-sm text-muted-foreground">Check the microphone and the speaker before you answer calls here. These choices belong to this browser.</p>
      </div>

      {secure ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Microphone: {PERMISSION_TEXT[permission]}
          </p>
          {mics.length > 0 && (
            <Select
              value={chosen}
              onValueChange={(v) => {
                setMic(v);
                picked.current = v;
                setOpened(null);
                prefs.setMic(me.id, v);
                stopTest.current?.();
              }}
            >
              <SelectTrigger className="w-72" aria-label="Microphone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mics.map((m, i) => (
                  <SelectItem key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={test}>{testing ? 'Stop the test' : 'Test the microphone'}</Button>
            <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} className="h-2 w-48 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary transition-[width] duration-75" style={{ width: `${level}%` }} />
            </div>
          </div>
          {problem && <p role="alert" className="text-sm text-amber-300">{problem}</p>}
        </div>
      ) : (
        <p role="alert" className="text-sm text-amber-300">
          Calls in the dashboard need this page on HTTPS: ask your administrator. Until then the microphone and desktop alerts can’t be checked here.
        </p>
      )}

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Speaker
        </p>
        <Button variant="outline" onClick={playTestTone}>Play a test sound</Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="calls-ringer" className="text-sm text-foreground">Ring for incoming calls</Label>
          <p className="text-xs text-muted-foreground">Off: a call still shows its banner, without a sound, even one already ringing.</p>
        </div>
        <Switch
          id="calls-ringer"
          checked={!ringerMuted}
          onCheckedChange={(on) => prefs.setRingerMuted(me.id, !on)}
        />
      </div>

      {secure && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Desktop alerts
            </p>
            <p className="text-xs text-muted-foreground">A call that rings while this tab is in the background shows a desktop alert.</p>
          </div>
          {alerts === 'granted' ? (
            <span className="text-sm text-foreground">Desktop alerts are on</span>
          ) : alerts === 'denied' ? (
            <span className="text-sm text-amber-300">Blocked in the browser’s site settings</span>
          ) : alerts === 'unsupported' ? (
            <span className="text-sm text-muted-foreground">Not available in this browser</span>
          ) : (
            <Button variant="outline" onClick={async () => setAlerts(await Notification.requestPermission())}>Turn on desktop alerts</Button>
          )}
        </div>
      )}
    </section>
  );
}
