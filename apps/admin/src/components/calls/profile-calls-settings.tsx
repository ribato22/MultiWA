'use client';
// A profile's calls settings (owner and admin): answering its calls in the dashboard, with what that still needs;
// recording them; the announcement the caller hears first; how long recordings are kept.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Play, Trash2, Upload, XCircle } from 'lucide-react';
import { api, type CallsMediaStatus } from '@/lib/api';
import { READINESS_TEXT, reasonTexts } from '@/lib/calls';
import { canManageCalls, currentUser } from '@/lib/current-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

const FORMAT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
type ProfileCalls = CallsMediaStatus['profiles'][number];
type Refusal = { message: string; texts: string[] };
// The server-wide readiness reasons: the checklist's server lines say them, once.
const SERVER_REASONS = ['media_disabled', 'media_server_down', 'engine_host_worker'];

/** `refreshKey`: what the page knows that the profile's readiness depends on; a change reads the checklist again. */
export function ProfileCallsSettings({ profileId, refreshKey }: { profileId: string; refreshKey?: string }) {
  const [allowed] = useState(() => canManageCalls(currentUser()?.role));
  const { toast } = useToast();
  const [server, setServer] = useState<CallsMediaStatus['server'] | null>(null);
  const [p, setP] = useState<ProfileCalls | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retention, setRetention] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api.getCallsMediaStatus();
    if (!res.data) return setLoadError(res.error ?? 'Could not read the calls status');
    setLoadError(null);
    setServer(res.data.server);
    const mine = res.data.profiles.find((x) => x.profileId === profileId) ?? null;
    setP(mine);
    if (mine) setRetention(String(mine.retentionDays));
  }, [profileId]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load, refreshKey]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  if (!allowed) return null;

  const refused = (message: string | undefined, body: any) => setRefusal({ message: message ?? 'Not available', texts: reasonTexts(body?.reasons ?? []) });
  const dropPreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };
  /** A refused change shows why, in the server's own reasons; a saved one shows the settings as stored. */
  const save = async (what: string, body: { answerInDashboard?: boolean; recording?: boolean; retentionDays?: number }) => {
    setBusy(what);
    setRefusal(null);
    const res = await api.updateCallsSettings(profileId, body);
    setBusy(null);
    if (res.status === 409) return refused(res.error, res.body);
    if (!res.data) return toast({ title: 'Could not save', description: res.error, variant: 'destructive' });
    const stored = res.data;
    setP((x) => (x ? { ...x, ...stored } : x));
    setRetention(String(stored.retentionDays));
  };
  const upload = async (f: File) => {
    setBusy('upload');
    setRefusal(null);
    const res = await api.uploadCallsAnnouncement(profileId, f);
    setBusy(null);
    if (file.current) file.current.value = ''; // the same file may be picked again
    if (!res.data) return refused(res.error ?? 'The announcement could not be stored', res.body);
    const announcement = res.data.announcement;
    setP((x) => (x ? { ...x, announcement } : x));
    dropPreview();
  };
  const listen = async () => {
    setBusy('listen');
    const res = await api.fetchCallsAnnouncement(profileId);
    setBusy(null);
    if (!res.blob) return toast({ title: 'Could not load the announcement', description: res.error, variant: 'destructive' });
    dropPreview();
    setPreview(URL.createObjectURL(res.blob));
  };
  const remove = async () => {
    setBusy('remove');
    setRefusal(null);
    const res = await api.deleteCallsAnnouncement(profileId);
    setBusy(null);
    if (res.error) return refused(res.error, res.body);
    setP((x) => (x ? { ...x, announcement: null } : x));
    dropPreview();
  };

  const days = Number(retention);
  const retentionValid = Number.isInteger(days) && days >= 1 && days <= 3650;
  const checks =
    server && p
      ? [
          { ok: server.enabled, text: server.enabled ? 'Calls in the dashboard are on, on the server' : READINESS_TEXT.media_disabled },
          ...(server.enabled ? [{ ok: server.worker === 'up', text: server.worker === 'up' ? 'The call media server runs' : READINESS_TEXT.media_server_down }] : []),
          { ok: server.engineHost === 'api', text: server.engineHost === 'api' ? 'The engines run in the API' : READINESS_TEXT.engine_host_worker },
          ...(p.ready
            ? [{ ok: true, text: 'This profile can take calls in the dashboard' }]
            : reasonTexts(p.reasons.filter((r) => !SERVER_REASONS.includes(r)), READINESS_TEXT).map((text) => ({ ok: false, text }))),
        ]
      : [];

  return (
    <section aria-label="Calls" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Calls</h2>
        <p className="mt-0.5 text-xs text-slate-400">Answer this profile’s WhatsApp voice calls in the dashboard, and record them.</p>
      </div>
      {loadError && <p role="alert" className="text-sm text-amber-300">{loadError}</p>}
      {server && p && (
        <>
          <div className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="calls-answer" className="cursor-pointer text-xs font-medium text-slate-200">Answer calls in the dashboard</Label>
                <p className="mt-0.5 text-[11px] text-slate-400">Agents online get a banner and answer in the browser.</p>
              </div>
              <Switch id="calls-answer" checked={p.answerInDashboard} disabled={busy === 'answer'} onCheckedChange={(on) => save('answer', { answerInDashboard: on })} />
            </div>
            <ul aria-label="What answering in the dashboard needs" className="space-y-1 text-xs">
              {checks.map((c) => (
                <li key={c.text} className="flex items-center gap-2">
                  {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
                  <span className="sr-only">{c.ok ? 'Ready: ' : 'Missing: '}</span>
                  <span className={c.ok ? 'text-slate-300' : 'text-amber-200'}>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="calls-record" className="cursor-pointer text-xs font-medium text-slate-200">Record calls</Label>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {p.announcement
                    ? 'The caller hears the announcement first, then the agent. Owners and admins can play the recordings.'
                    : 'Upload an announcement first: the caller hears it before the agent.'}
                </p>
              </div>
              <Switch
                id="calls-record"
                checked={p.recording}
                disabled={busy === 'recording' || (!p.recording && !p.announcement)}
                onCheckedChange={(on) => save('recording', { recording: on })}
              />
            </div>
            {server.recordings.problem && <p className="text-[11px] text-amber-300">Recording storage: {server.recordings.problem}</p>}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-200">Announcement</p>
              <p className="text-[11px] text-slate-400">
                {p.announcement
                  ? `${FORMAT[p.announcement.mimeType] ?? p.announcement.mimeType} · ${p.announcement.durationSec.toFixed(1)} s`
                  : 'None yet. An mp3, wav, ogg, webm or m4a file of at most 2 MB and 30 seconds.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={file}
                  type="file"
                  hidden
                  aria-label="Announcement file"
                  accept=".mp3,.wav,.ogg,.webm,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <Button size="sm" variant="outline" disabled={busy === 'upload'} onClick={() => file.current?.click()}>
                  {busy === 'upload' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {p.announcement ? 'Replace' : 'Upload announcement'}
                </Button>
                {p.announcement && (
                  <Button size="sm" variant="outline" disabled={busy === 'listen'} onClick={listen}>
                    <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Listen
                  </Button>
                )}
                {p.announcement && (
                  <Button size="sm" variant="ghost" disabled={busy === 'remove'} onClick={remove}>
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              {preview && <audio controls src={preview} aria-label="The announcement" className="h-8" />}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800/80 bg-slate-950/30 p-4">
            <div className="space-y-1">
              <Label htmlFor="calls-retention" className="text-xs font-medium text-slate-200">Keep recordings for (days)</Label>
              <Input
                id="calls-retention"
                type="number"
                min={1}
                max={3650}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className="w-32 border-slate-800 bg-slate-950/40 text-slate-100"
              />
              <p className="text-[11px] text-slate-400">1 to 3650. Older recordings are deleted every night.</p>
            </div>
            <Button size="sm" disabled={!retentionValid || days === p.retentionDays || busy === 'retention'} onClick={() => save('retention', { retentionDays: days })}>
              Save
            </Button>
          </div>

          {refusal && (
            <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <p className="font-medium">{refusal.message}</p>
              {refusal.texts.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {refusal.texts.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
