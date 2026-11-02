'use client';
// A call's recording on the Calls page: its facts for every role; play, download and delete for owner and admin.
import { useEffect, useState } from 'react';
import { CircleDot, Download, Loader2, Play, Trash2 } from 'lucide-react';
import { api, type CallRecord } from '@/lib/api';
import { RECORDING_DELETED_TEXT, callerLabel, formatDuration } from '@/lib/calls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function CallRecording({ call, canManage, onChange }: { call: CallRecord; canManage: boolean; onChange: (row: CallRecord) => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'play' | 'download' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const r = call.recording;
  if (!r) return null;
  if (r.deletedAt) return <Badge variant="outline">{RECORDING_DELETED_TEXT[r.deleteReason ?? 'admin']}</Badge>;
  // A browser that cannot play WebM/Opus (an older Safari) can still download it.
  const playable = typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';
  const failed = (title: string, description?: string) => toast({ title, description, variant: 'destructive' });

  // The whole file comes before it plays (seeking then works in the blob): about 0.5 MB a minute.
  const play = async () => {
    setBusy('play');
    const res = await api.fetchCallRecording(call.id);
    setBusy(null);
    if (!res.blob) return failed('Could not load the recording', res.error);
    setUrl(URL.createObjectURL(res.blob));
  };
  const download = async () => {
    setBusy('download');
    const res = await api.fetchCallRecording(call.id, true);
    setBusy(null);
    if (!res.blob) return failed('Could not download the recording', res.error);
    const href = URL.createObjectURL(res.blob);
    Object.assign(document.createElement('a'), { href, download: `call-${call.id}.webm` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  };
  const remove = async () => {
    setBusy('delete');
    const res = await api.deleteCallRecording(call.id);
    // No realtime update follows a delete: the row is read again. One already gone (404) reads the same way.
    const row = res.error && res.status !== 404 ? null : (await api.getCall(call.id)).data;
    setBusy(null);
    setConfirming(false);
    if (!row) return failed('Could not delete the recording', res.error);
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    onChange(row);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" className="gap-1">
        <CircleDot className="h-3 w-3" aria-hidden="true" />
        Recording {formatDuration(r.durationSec)}
      </Badge>
      {r.partial && <Badge variant="outline" title="The server stopped before the call ended: the file holds the call up to then">Partial</Badge>}
      {canManage && (
        <>
          {url ? (
            <audio controls autoPlay src={url} aria-label={`Recording of the call with ${callerLabel(call)}`} className="h-8 max-w-[16rem]" />
          ) : playable ? (
            <Button size="sm" variant="outline" disabled={busy === 'play'} onClick={play}>
              {busy === 'play' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {busy === 'play' ? `Loading ${mb(r.bytes)}…` : 'Play'}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy === 'download'} onClick={download} aria-label="Download the recording">
            {busy === 'download' ? <Loader2 className="h-4 w-4 mw-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label="Delete the recording">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
                <AlertDialogDescription>
                  The recording of the call with {callerLabel(call)} is deleted for good; the call stays listed. The deletion is logged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy === 'delete'}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy === 'delete'}
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
