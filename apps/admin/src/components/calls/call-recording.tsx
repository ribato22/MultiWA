'use client';
// A call's recording on the Calls page: its facts for every role; play, download and delete for owner and admin.
import { useEffect, useRef, useState } from 'react';
import { CircleDot, Download, Loader2, Play, Trash2 } from 'lucide-react';
import { api, type CallRecord } from '@/lib/api';
import { RECORDING_DELETED_TEXT, callerLabel, formatDuration } from '@/lib/calls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const mb = (bytes: number) => (bytes < 100_000 ? '< 0.1 MB' : `${(bytes / 1_000_000).toFixed(1)} MB`);
// The recording that plays on the page: playing another pauses it. Only these players, never the call console's own
// <audio> (the caller's voice).
let playing: HTMLAudioElement | null = null;

export function CallRecording({ call, canManage, onChange }: { call: CallRecord; canManage: boolean; onChange: (row: CallRecord) => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  // The row's action in flight, one at a time: each fetch of the file is audited, and the buttons say what runs. The
  // others wait as aria-disabled, not disabled, and ignore a press: the one pressed keeps the focus.
  const [busy, setBusy] = useState<'play' | 'download' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const deletedText = useRef<HTMLSpanElement>(null);
  // Set when this row's own action deleted the recording: its buttons go, and the focus must not fall to the page.
  const focusDeleted = useRef(false);
  // Aborted when the row goes (another tab, profile or page): a file still loading is given up, not kept for nothing.
  const gone = useRef<AbortSignal>();
  const r = call.recording;
  useEffect(() => {
    const leaving = new AbortController();
    gone.current = leaving.signal;
    return () => leaving.abort();
  }, []);
  // The player takes the focus from Play, which it replaces, not from where the agent went meanwhile; its file goes
  // with it.
  useEffect(() => {
    if (!url) return;
    const el = player.current;
    if (document.activeElement === document.body) el?.focus();
    return () => {
      URL.revokeObjectURL(url);
      if (playing === el) playing = null;
    };
  }, [url]);
  useEffect(() => {
    if (r?.deletedAt && focusDeleted.current) deletedText.current?.focus();
    focusDeleted.current = false;
  }, [r?.deletedAt]);
  if (!r) return null;
  if (r.deletedAt) {
    return (
      <span ref={deletedText} tabIndex={-1}>
        <Badge variant="outline">{RECORDING_DELETED_TEXT[r.deleteReason ?? 'admin']}</Badge>
      </span>
    );
  }
  // A browser that cannot play WebM/Opus (an older Safari) can still download it.
  const playable = typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';
  const failed = (title: string, description?: string) => toast({ title, description, variant: 'destructive' });
  /** The row as the server has it now: a recording deleted meanwhile says so, and its player goes. */
  const show = (row: CallRecord) => {
    if (row.recording?.deletedAt) {
      focusDeleted.current = true;
      setUrl(null);
    }
    onChange(row);
  };
  /** The file, or null once the row went meanwhile. A 404 is a recording deleted since the list was read (its retention). */
  const fetchFile = async (download: boolean) => {
    const signal = gone.current;
    const res = await api.fetchCallRecording(call.id, download, signal);
    if (signal?.aborted) return null;
    setBusy(null);
    if (res.status === 404) {
      void api.getCall(call.id).then(({ data }) => {
        if (data && !signal?.aborted) show(data);
      });
    }
    return res;
  };

  // The whole file comes before it plays (seeking then works in the blob): about 0.5 MB a minute.
  const play = async () => {
    if (busy) return;
    setBusy('play');
    const res = await fetchFile(false);
    if (!res) return;
    if (!res.blob) return failed('Could not load the recording', res.error);
    setUrl(URL.createObjectURL(res.blob));
  };
  const download = async () => {
    if (busy) return;
    setBusy('download');
    const res = await fetchFile(true);
    if (!res) return;
    if (!res.blob) return failed('Could not download the recording', res.error);
    const href = URL.createObjectURL(res.blob);
    Object.assign(document.createElement('a'), { href, download: `call-${call.id}.webm` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  };
  const remove = async () => {
    if (busy) return;
    setBusy('delete');
    const res = await api.deleteCallRecording(call.id);
    // One already gone (404) reads the same way as one deleted now.
    if (res.error && res.status !== 404) {
      setBusy(null);
      setConfirming(false);
      return failed('Could not delete the recording', res.error);
    }
    // No realtime update follows a delete: the row is read again. When that read fails, the row still says so.
    const deletedAt = res.data?.deletedAt ?? new Date().toISOString();
    const row = (await api.getCall(call.id)).data ?? { ...call, recording: { ...r, deletedAt, deleteReason: 'admin' as const } };
    setBusy(null);
    setConfirming(false);
    toast({ title: 'Recording deleted' });
    show(row);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" className="gap-1">
        <CircleDot className="h-3 w-3" aria-hidden="true" />
        Recording {formatDuration(r.durationSec)}
      </Badge>
      {r.partial && <Badge variant="outline">Partial: the server stopped before the call ended</Badge>}
      {canManage && (
        <>
          {url ? (
            <audio
              ref={player}
              controls
              autoPlay
              src={url}
              onPlay={(e) => {
                if (playing && playing !== e.currentTarget) playing.pause();
                playing = e.currentTarget;
              }}
              aria-label={`Recording of the call from ${callerLabel(call)}`}
              className="h-8 max-w-[16rem]"
            />
          ) : playable ? (
            // Named with the call, as every row has one; while it loads, its text says so.
            <Button
              size="sm"
              variant="outline"
              aria-disabled={!!busy}
              onClick={play}
              aria-label={busy === 'play' ? undefined : `Play the recording of the call from ${callerLabel(call)}`}
            >
              {busy === 'play' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {busy === 'play' ? `Loading ${mb(r.bytes)}…` : 'Play'}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" aria-disabled={!!busy} onClick={download} aria-label={`Download the recording of the call from ${callerLabel(call)}`}>
            {busy === 'download' ? <Loader2 className="h-4 w-4 mw-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          </Button>
          {/* The trigger gets the focus back when the dialog closes without a delete. It stays open, Escape too, while
              the delete runs: its answer closes it. */}
          <AlertDialog open={confirming} onOpenChange={(open) => busy !== 'delete' && setConfirming(open)}>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-disabled={!!busy}
                onClick={(e) => busy && e.preventDefault()}
                aria-label={`Delete the recording of the call from ${callerLabel(call)}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
                <AlertDialogDescription>
                  The recording of the call from {callerLabel(call)} is deleted for good; the call stays listed. The deletion is logged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy === 'delete'}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  aria-disabled={busy === 'delete'}
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={(e) => {
                    e.preventDefault(); // the dialog closes once the delete is done
                    void remove();
                  }}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
