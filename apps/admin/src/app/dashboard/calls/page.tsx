// MultiWA Admin - Calls: the incoming-call queue
// apps/admin/src/app/dashboard/calls/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import {
  CheckCircle2, Link2, Loader2, MessageSquareText, MessagesSquare, Phone, PhoneIncoming,
  PhoneMissed, PhoneOff, RotateCcw, UserPlus, Video,
} from 'lucide-react';
import { api, type CallFollowUp, type CallRecord, type Profile } from '@/lib/api';
import { getSocketUrl } from '@/lib/socket';
import { formatFull, formatRelative } from '@/lib/datetime';
import {
  CALL_FILTERS, FOLLOW_UP_LABEL, OUTCOME_LABEL, callerLabel, filterQuery, fromPayload, upsertCall,
  type CallFilter, type CallUpdatePayload,
} from '@/lib/calls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';

type Member = { id: string; name: string; email: string; isActive: boolean };
type DialogState = { kind: 'reply' | 'link' | 'assign'; call: CallRecord } | null;
const UNASSIGNED = '__none__';

function OutcomeIcon({ call }: { call: CallRecord }) {
  if (call.outcome === 'ringing') return <PhoneIncoming className="w-4 h-4 text-primary animate-pulse" aria-hidden="true" />;
  if (call.outcome === 'rejected') return <PhoneOff className="w-4 h-4 text-amber-400" aria-hidden="true" />;
  if (call.outcome === 'answered_elsewhere') return <Phone className="w-4 h-4 text-emerald-400" aria-hidden="true" />;
  return <PhoneMissed className="w-4 h-4 text-red-400" aria-hidden="true" />;
}

export default function CallsPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [filter, setFilter] = useState<CallFilter>('open');
  // The socket handler reads the tab through this ref: a tab change must not reconnect the socket.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [ringing, setRinging] = useState<CallRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [text, setText] = useState('');
  const [linkType, setLinkType] = useState<'voice' | 'video'>('voice');
  const [assignee, setAssignee] = useState(UNASSIGNED);
  const [busy, setBusy] = useState<string | null>(null);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId), [profiles, profileId]);
  const memberName = useCallback((id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? null : null), [members]);

  useEffect(() => {
    api.getProfiles().then((res) => {
      const list = Array.isArray(res.data) ? res.data : [];
      setProfiles(list);
      setProfileId((current) => current || list[0]?.id || '');
      if (!list.length) setLoading(false);
    });
    api.getUsers().then((res) => setMembers((res.data ?? []).filter((m) => m.isActive)));
  }, []);

  const load = useCallback(async (cursor?: string) => {
    if (!profileId) return;
    setLoading(true);
    const res = await api.getCalls(profileId, { ...filterQuery(filter), cursor });
    setLoading(false);
    if (res.error || !res.data) {
      toast({ title: 'Could not load calls', description: res.error, variant: 'destructive' });
      return;
    }
    const page = res.data;
    // A realtime update can insert a row that a later page returns again: skip the ids already listed.
    setCalls((prev) => (cursor ? [...prev, ...page.calls.filter((c) => !prev.some((x) => x.id === c.id))] : page.calls));
    setNextCursor(page.nextCursor);
    if (!cursor) setRinging(page.calls.filter((c) => c.outcome === 'ringing'));
  }, [profileId, filter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: new calls ring in, outcomes and follow-ups update in place.
  useEffect(() => {
    if (!profileId) return;
    const socket = io(`${getSocketUrl()}/ws`, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') ?? undefined : undefined }),
      reconnection: true,
    });
    socket.on('connect', () => socket.emit('join', { profileId }));
    socket.on('call:update', (p: CallUpdatePayload) => {
      if (p.profileId !== profileId) return;
      setCalls((prev) => upsertCall(prev, p, filterRef.current));
      setRinging((prev) => {
        const others = prev.filter((c) => c.id !== p.callId);
        return p.outcome === 'ringing' ? [fromPayload(p, prev.find((c) => c.id === p.callId)), ...others] : others;
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [profileId]);

  const run = async (call: CallRecord, action: () => Promise<{ error?: string }>, success: string) => {
    setBusy(call.id);
    const res = await action();
    setBusy(null);
    if (res.error) {
      toast({ title: 'Action failed', description: res.error, variant: 'destructive' });
      return false;
    }
    toast({ title: success });
    void load();
    return true;
  };

  const openDialog = (kind: 'reply' | 'link' | 'assign', call: CallRecord) => {
    setText(kind === 'reply' ? String(profile?.settings?.callReplyMessage ?? '') : '');
    setLinkType(call.isVideo ? 'video' : 'voice');
    setAssignee(call.assignedUserId ?? UNASSIGNED);
    setDialog({ kind, call });
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const { kind, call } = dialog;
    const ok =
      kind === 'reply'
        ? await run(call, () => api.replyToCall(call.id, text.trim() || undefined), 'Reply sent')
        : kind === 'link'
          ? await run(call, () => api.sendCallLink(call.id, linkType, text.trim() || undefined), 'Call link sent')
          : await run(call, () => api.updateCall(call.id, { assignedUserId: assignee === UNASSIGNED ? null : assignee }), 'Assignment saved');
    if (ok) setDialog(null);
  };

  const setFollowUp = (call: CallRecord, followUp: CallFollowUp) =>
    run(call, () => api.updateCall(call.id, { followUp }), followUp === 'done' ? 'Marked done' : 'Reopened');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calls</h1>
          <p className="text-sm text-muted-foreground">Incoming WhatsApp calls and their follow-up.</p>
        </div>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Profile">
            <SelectValue placeholder="Select a profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.displayName || p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {ringing.length > 0 && (
        <section aria-label="Ringing now" className="space-y-2">
          {ringing.map((call) => (
            <Card key={call.id} className="border-primary/40 bg-primary/5">
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <PhoneIncoming className="w-5 h-5 text-primary animate-pulse" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{callerLabel(call)}</p>
                    <p className="text-xs text-muted-foreground">Ringing · {call.isVideo ? 'video' : 'voice'} call</p>
                  </div>
                </div>
                <Button size="sm" variant="destructive" disabled={busy === call.id} onClick={() => run(call, () => api.rejectCall(call.id), 'Call rejected')}>
                  {busy === call.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PhoneOff className="w-4 h-4" aria-hidden="true" />}
                  <span className="ml-1.5">Reject</span>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as CallFilter)}>
        <TabsList>
          {CALL_FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading && calls.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : calls.length === 0 ? (
        <EmptyState icon={<PhoneIncoming className="w-8 h-8" aria-hidden="true" />} title="No calls here" description="Incoming calls to this profile appear here." />
      ) : (
        <ul className="space-y-2" aria-label="Calls">
          {calls.map((call) => {
            const assigned = memberName(call.assignedUserId) ?? call.assignedUser?.name ?? null;
            const disabled = busy === call.id;
            return (
              <li key={call.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <OutcomeIcon call={call} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{callerLabel(call)}</p>
                        <p className="text-xs text-muted-foreground" title={formatFull(call.startedAt)}>
                          {call.isVideo && <Video className="inline w-3 h-3 mr-1" aria-label="Video call" />}
                          {formatRelative(call.startedAt)}
                          {assigned ? ` · ${assigned}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={call.outcome === 'missed' ? 'destructive' : 'secondary'}>{OUTCOME_LABEL[call.outcome]}</Badge>
                      <Badge variant="outline">{FOLLOW_UP_LABEL[call.followUp]}</Badge>
                      {call.conversationId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/dashboard/chat?conv=${call.conversationId}`} aria-label="Open chat">
                            <MessagesSquare className="w-4 h-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      )}
                      {!call.isGroup && (
                        <>
                          <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog('reply', call)}>
                            <MessageSquareText className="w-4 h-4" aria-hidden="true" />
                            <span className="ml-1.5">Reply</span>
                          </Button>
                          <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog('link', call)}>
                            <Link2 className="w-4 h-4" aria-hidden="true" />
                            <span className="ml-1.5">Call link</span>
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" disabled={disabled} onClick={() => openDialog('assign', call)}>
                        <UserPlus className="w-4 h-4" aria-hidden="true" />
                        <span className="ml-1.5">Assign</span>
                      </Button>
                      {call.followUp === 'done' ? (
                        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setFollowUp(call, 'open')}>
                          <RotateCcw className="w-4 h-4" aria-hidden="true" />
                          <span className="ml-1.5">Reopen</span>
                        </Button>
                      ) : (
                        <Button size="sm" disabled={disabled} onClick={() => setFollowUp(call, 'done')}>
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span className="ml-1.5">Done</span>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => load(nextCursor)}>Load more</Button>
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === 'reply' ? 'Reply to caller' : dialog?.kind === 'link' ? 'Send a call link' : 'Assign call'}</DialogTitle>
            <DialogDescription>{dialog ? callerLabel(dialog.call) : ''}</DialogDescription>
          </DialogHeader>
          {dialog?.kind === 'assign' ? (
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger aria-label="Assignee"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-3">
              {dialog?.kind === 'link' && (
                <Select value={linkType} onValueChange={(v) => setLinkType(v as 'voice' | 'video')}>
                  <SelectTrigger aria-label="Call type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voice">Voice call</SelectItem>
                    <SelectItem value="video">Video call</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Textarea
                aria-label="Message"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={dialog?.kind === 'link' ? 'Optional text sent with the link' : 'Message to the caller'}
              />
              {dialog?.kind === 'link' && (
                <p className="text-xs text-muted-foreground">
                  The caller joins from the link. Answer it from a phone or WhatsApp Desktop logged in to this number.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button disabled={!!busy || (dialog?.kind === 'reply' && !text.trim())} onClick={submitDialog}>
              {busy ? 'Sending…' : dialog?.kind === 'assign' ? 'Save' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
