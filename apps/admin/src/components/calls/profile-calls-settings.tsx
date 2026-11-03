'use client';
// A profile's calls settings (owner and admin): answering its calls in the dashboard, with what that still needs;
// recording them; the announcement the caller hears first; how long recordings are kept.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Play, Trash2, Upload, XCircle } from 'lucide-react';
import { ANNOUNCEMENT_MAX_BYTES, api, type CallsMediaStatus } from '@/lib/api';
import { READINESS_TEXT, reasonTexts } from '@/lib/calls';
import { canManageCalls, currentUser } from '@/lib/current-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useCalls } from './calls-provider';

const FORMAT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
type ProfileCalls = CallsMediaStatus['profiles'][number];
type Refusal = { message: string; texts: string[] };
// The server-wide readiness reasons: the checklist's server lines say them, once.
const SERVER_REASONS = ['media_disabled', 'media_server_down', 'engine_host_worker'];

/**
 * What the server would refuse anyway, said before the file is sent: its size, or a file that is no audio file by its
 * type or its name (the server reads the format from the file itself).
 */
const fileProblem = (f: File) =>
  f.size > ANNOUNCEMENT_MAX_BYTES
    ? `The file must be at most ${ANNOUNCEMENT_MAX_BYTES / (1024 * 1024)} MB`
    : !FORMAT[f.type] && !Object.values(FORMAT).includes(f.name.split('.').pop()?.toLowerCase() ?? '')
      ? 'The announcement must be an mp3, wav, ogg, webm or m4a file'
      : null;

/** `refreshKey`: what the page knows that the profile's readiness depends on; a change reads the checklist again. */
export function ProfileCallsSettings({ profileId, refreshKey }: { profileId: string; refreshKey?: string }) {
  const [allowed] = useState(() => canManageCalls(currentUser()?.role));
  const calls = useCalls();
  const { toast } = useToast();
  const [server, setServer] = useState<CallsMediaStatus['server'] | null>(null);
  const [p, setP] = useState<ProfileCalls | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // The change in flight. Every control waits meanwhile: each answer is the whole settings, and two could cross. They
  // wait as aria-disabled, not disabled, and ignore a press: the control pressed keeps the focus, for a keyboard and a
  // screen reader.
  const [busy, setBusy] = useState<string | null>(null);
  // The retention as typed, until it is saved: a read of the settings meanwhile leaves it.
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  // Only the latest read shows: an older one answering after it (a slow link) is stale, and so is one still out when a
  // change answers (it may have left before the change): the page reads again then.
  const loadSeq = useRef(0);
  // The latest read that answered: a read is out while this is behind loadSeq.
  const settled = useRef(0);
  // The latest read out when a refusal showed: a read that left by then does not clear it when it answers.
  const refusedAt = useRef(0);
  // Aborted when the section goes: an announcement still loading is given up, not kept for nothing.
  const gone = useRef<AbortSignal>();

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setChecking(true);
    const res = await api.getCallsMediaStatus();
    if (seq !== loadSeq.current) return;
    settled.current = seq;
    setChecking(false);
    if (!res.data) return setLoadError(res.error ?? 'Could not read the calls status');
    setLoadError(null);
    // What was refused may be fixed since, if this read left after it: the checklist, and the storage's last check, say
    // what is still missing.
    if (seq > refusedAt.current) setRefusal(null);
    setServer(res.data.server);
    setP(res.data.profiles.find((x) => x.profileId === profileId) ?? null);
  }, [profileId]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load, refreshKey]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    const leaving = new AbortController();
    gone.current = leaving.signal;
    return () => leaving.abort();
  }, []);
  if (!allowed) return null;

  const showRefusal = (r: Refusal) => {
    refusedAt.current = loadSeq.current;
    setRefusal(r);
  };
  const refused = (message: string | undefined, body: any) => showRefusal({ message: message ?? 'Not available', texts: reasonTexts(body?.reasons ?? []) });
  // A change answered: a read still out may have left before it, and reads again. Not after a refusal, which changed
  // nothing.
  const readAgain = () => {
    if (settled.current !== loadSeq.current) void load();
  };
  const dropPreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };
  /** A refused change shows why, in the server's own reasons; a saved one shows the settings as stored. */
  const save = async (what: string, body: { answerInDashboard?: boolean; recording?: boolean; retentionDays?: number }) => {
    if (busy) return;
    setBusy(what);
    setRefusal(null);
    const res = await api.updateCallsSettings(profileId, body);
    setBusy(null);
    if (res.status === 409) return refused(res.error, res.body);
    readAgain();
    if (!res.data) return toast({ title: 'Could not save', description: res.error, variant: 'destructive' });
    const stored = res.data;
    setP((x) => (x ? { ...x, ...stored } : x));
    if (body.retentionDays !== undefined) setRetentionDraft(null);
    // Its calls ring in the dashboard from now on: the header's call controls show without a reload.
    if (stored.answerInDashboard) calls?.profileAnswers();
  };
  const upload = async (f: File) => {
    if (file.current) file.current.value = ''; // the same file may be picked again
    const problem = fileProblem(f);
    if (problem) return showRefusal({ message: problem, texts: [] });
    setBusy('upload');
    setRefusal(null);
    const res = await api.uploadCallsAnnouncement(profileId, f);
    setBusy(null);
    if (!res.data) return refused(res.error ?? 'The announcement could not be stored', res.body);
    readAgain();
    const announcement = res.data.announcement;
    setP((x) => (x ? { ...x, announcement } : x));
    dropPreview();
  };
  const listen = async () => {
    if (busy) return;
    setBusy('listen');
    const signal = gone.current;
    const res = await api.fetchCallsAnnouncement(profileId, signal);
    if (signal?.aborted) return;
    setBusy(null);
    if (!res.blob) return toast({ title: 'Could not load the announcement', description: res.error, variant: 'destructive' });
    dropPreview();
    setPreview(URL.createObjectURL(res.blob));
  };
  const remove = async () => {
    if (busy) return;
    setBusy('remove');
    setRefusal(null);
    const res = await api.deleteCallsAnnouncement(profileId);
    setBusy(null);
    setConfirmRemove(false);
    if (res.error) return refused(res.error, res.body);
    readAgain();
    setP((x) => (x ? { ...x, announcement: null } : x));
    dropPreview();
  };

  const retention = retentionDraft ?? (p ? String(p.retentionDays) : '');
  const days = Number(retention);
  const retentionValid = Number.isInteger(days) && days >= 1 && days <= 3650;
  const retentionChanged = retentionValid && days !== p?.retentionDays;
  // The storage's last privacy check (recording turned on, or the nightly one) failed: why recording is off, in the words
  // of the refusal. An unset storage is the `problem`, said already.
  const lastCheck = server?.recordings.lastCheck;
  const checkFailed = lastCheck && !lastCheck.ok && lastCheck.reason !== 'recordings_storage_unset' ? (lastCheck.reason ?? 'storage_check_failed') : null;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Calls</h2>
          <p className="mt-0.5 text-xs text-slate-400">Answer this profile’s WhatsApp voice calls in the dashboard, and record them.</p>
        </div>
        {/* What changed elsewhere (the server, WhatsApp) shows once the checklist is read again. */}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {!server && !loadError && <p className="text-sm text-slate-400">Reading the calls status…</p>}
      {loadError && <p role="alert" className="text-sm text-amber-300">{loadError}</p>}
      {server && !p && <p className="text-sm text-amber-300">The calls status does not list this profile: reload the page, or check again in a moment.</p>}
      {server && p && (
        <>
          <div className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="calls-answer" className="cursor-pointer text-xs font-medium text-slate-200">Answer calls in the dashboard</Label>
                <p className="mt-0.5 text-[11px] text-slate-400">Agents online get a banner and answer in the browser.</p>
              </div>
              <Switch id="calls-answer" checked={p.answerInDashboard} aria-disabled={!!busy} onCheckedChange={(on) => save('answer', { answerInDashboard: on })} />
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
                disabled={!p.recording && !p.announcement}
                aria-disabled={!!busy}
                onCheckedChange={(on) => save('recording', { recording: on })}
              />
            </div>
            {server.recordings.problem && <p className="text-[11px] text-amber-300">Recording storage: {server.recordings.problem}</p>}
            {checkFailed && <p className="text-[11px] text-amber-300">{reasonTexts([checkFailed])}</p>}
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
                <Button ref={uploadButton} size="sm" variant="outline" aria-disabled={!!busy} onClick={() => !busy && file.current?.click()}>
                  {busy === 'upload' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {p.announcement ? 'Replace' : 'Upload announcement'}
                </Button>
                {p.announcement && (
                  <Button size="sm" variant="outline" aria-disabled={!!busy} onClick={listen}>
                    <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Listen
                  </Button>
                )}
                {/* Remove is the trigger, so the focus comes back to it; the dialog itself stays when Remove goes with
                    the announcement, and its close then hands the focus to the upload. It stays open, Escape too,
                    while the removal runs: its answer closes it. */}
                <AlertDialog open={confirmRemove} onOpenChange={(open) => busy !== 'remove' && setConfirmRemove(open)}>
                  {p.announcement && (
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" aria-disabled={!!busy} onClick={(e) => busy && e.preventDefault()}>
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                  )}
                  <AlertDialogContent
                    onCloseAutoFocus={(e) => {
                      if (p?.announcement) return; // cancelled or refused: back to Remove
                      e.preventDefault(); // removed, and Remove with it: the focus goes to the upload, not to the page
                      uploadButton.current?.focus();
                    }}
                  >
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove the announcement?</AlertDialogTitle>
                      <AlertDialogDescription>Recording calls needs one: it can be turned on again once another announcement is uploaded.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={busy === 'remove'}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        aria-disabled={busy === 'remove'}
                        className="bg-red-600 text-white hover:bg-red-700"
                        onClick={(e) => {
                          e.preventDefault(); // the dialog closes once the server answered
                          void remove();
                        }}
                      >
                        {busy === 'remove' ? 'Removing…' : 'Remove'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {preview && <audio controls src={preview} aria-label="The announcement" className="h-8" />}
            </div>
          </div>

          {/* Enter in the field saves. The range is the server's, said here rather than in the browser's own bubble. */}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (retentionChanged) void save('retention', { retentionDays: days });
            }}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800/80 bg-slate-950/30 p-4"
          >
            <div className="space-y-1">
              <Label htmlFor="calls-retention" className="text-xs font-medium text-slate-200">Keep recordings for (days)</Label>
              <Input
                id="calls-retention"
                type="number"
                min={1}
                max={3650}
                value={retention}
                aria-invalid={!retentionValid}
                aria-describedby="calls-retention-help"
                onChange={(e) => setRetentionDraft(e.target.value)}
                className="w-32 border-slate-800 bg-slate-950/40 text-slate-100"
              />
              <p id="calls-retention-help" className={`text-[11px] ${retentionValid ? 'text-slate-400' : 'text-amber-300'}`}>
                {retentionValid ? '1 to 3650. Older recordings are deleted every night.' : 'A whole number of days from 1 to 3650'}
              </p>
            </div>
            {/* With nothing to save (just saved, too) it waits rather than go disabled: it keeps the focus. */}
            <Button type="submit" size="sm" aria-disabled={!retentionChanged || !!busy}>
              Save<span className="sr-only"> retention</span>
            </Button>
          </form>

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
