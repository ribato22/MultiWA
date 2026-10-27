// MultiWA Admin - Calls: the incoming-call queue
// apps/admin/src/app/dashboard/calls/page.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  CALL_FILTERS, FOLLOW_UP_LABEL, OUTCOME_LABEL, callerLabel, filterQuery, fromPayload, matchesFilter, upsertCall,
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
// `open: false` keeps the content while the dialog fades out.
type DialogState = { kind: 'reply' | 'link' | 'assign'; call: CallRecord; open: boolean } | null;
const UNASSIGNED = '__none__';
// The send gate answers 429 with a code and no message.
const GATE_REASON: Record<string, string> = {
  REPEAT_SUPPRESSED: 'The same text was just sent to this caller.',
  DAILY_LIMIT_REACHED: 'This profile has reached its daily message limit.',
  COLD_DAILY_LIMIT_REACHED: 'This profile has reached its daily limit for new conversations.',
  COLD_CIRCUIT_OPEN: 'Sending to new conversations is paused for this profile.',
};

function OutcomeIcon({ call }: { call: CallRecord }) {
  if (call.outcome === 'ringing') return <PhoneIncoming className="w-4 h-4 text-primary animate-pulse" aria-hidden="true" />;
  if (call.outcome === 'rejected') return <PhoneOff className="w-4 h-4 text-amber-400" aria-hidden="true" />;
  if (call.outcome === 'answered_elsewhere') return <Phone className="w-4 h-4 text-emerald-400" aria-hidden="true" />;
  return <PhoneMissed className={`w-4 h-4 ${call.outcome === 'unknown' ? 'text-muted-foreground' : 'text-red-400'}`} aria-hidden="true" />;
}

export default function CallsPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [filter, setFilter] = useState<CallFilter>('open');
  // The socket handler reads the tab through this ref: a tab change must not reconnect the socket.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  // A tab or profile switch leaves the previous request in flight: only the latest request of each kind may touch the state.
  const loadSeq = useRef(0);
  const ringingSeq = useRef(0);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [ringing, setRinging] = useState<CallRecord[]>([]);
  // The socket handler asks these whether it has seen a call before.
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const ringingRef = useRef(ringing);
  ringingRef.current = ringing;
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [text, setText] = useState('');
  const [linkType, setLinkType] = useState<'voice' | 'video'>('voice');
  const [assignee, setAssignee] = useState(UNASSIGNED);
  const [busy, setBusy] = useState<string[]>([]); // ids of the calls with an action in flight
  const opener = useRef<HTMLElement | null>(null);

  const memberName = useCallback((id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? null : null), [members]);

  useEffect(() => {
    api.getProfiles().then((res) => {
      if (res.error) toast({ title: 'Could not load profiles', description: res.error, variant: 'destructive' });
      const list = Array.isArray(res.data) ? res.data : [];
      setProfiles(list);
      setProfileId((current) => current || list[0]?.id || '');
      if (!list.length) setLoading(false);
    });
    api.getUsers().then((res) => {
      if (res.error) toast({ title: 'Could not load the team', description: res.error, variant: 'destructive' });
      setMembers((res.data ?? []).filter((m) => m.isActive));
    });
  }, [toast]);

  const load = useCallback(async (cursor?: string) => {
    if (!profileId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    const res = await api.getCalls(profileId, { ...filterQuery(filter), cursor });
    if (seq !== loadSeq.current) return; // a newer load started (another tab, profile or page): this answer is stale
    setLoading(false);
    if (res.error || !res.data) {
      toast({ title: 'Could not load calls', description: res.error, variant: 'destructive' });
      return;
    }
    const page = res.data;
    // A realtime update can insert a row that a later page returns again: skip the ids already listed.
    setCalls((prev) => (cursor ? [...prev, ...page.calls.filter((c) => !prev.some((x) => x.id === c.id))] : page.calls));
    setNextCursor(page.nextCursor);
  }, [profileId, filter, toast]);

  useEffect(() => {
    setCalls([]); // a tab or profile switch never shows the previous list, nor pages on with its cursor
    setNextCursor(null);
    void load();
  }, [load]);

  // The ringing strip belongs to the profile, not to the selected tab (Missed and Rejected never list a ringing call).
  const loadRinging = useCallback(async () => {
    if (!profileId) return;
    const seq = ++ringingSeq.current;
    const res = await api.getCalls(profileId, { outcome: 'ringing' });
    if (seq !== ringingSeq.current || !res.data) return; // stale (the profile changed), or failed: keep what the socket showed
    setRinging(res.data.calls);
  }, [profileId]);

  useEffect(() => {
    setRinging([]); // a profile switch never shows the previous profile's calls
    void loadRinging();
  }, [loadRinging]);

  // An action resolves after the user may have switched tab or profile: it reloads what is shown then, not at the click.
  const loaders = useRef({ load, loadRinging });
  loaders.current = { load, loadRinging };

  // Live: new calls ring in, outcomes and follow-ups update in place.
  useEffect(() => {
    if (!profileId) return;
    const socket = io(`${getSocketUrl()}/ws`, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') ?? undefined : undefined }),
      reconnection: true,
    });
    let joined = false;
    socket.on('connect', () => {
      socket.emit('join', { profileId });
      if (joined) { // a reconnect: what happened while the socket was down was never sent to it
        void loaders.current.load();
        void loaders.current.loadRinging();
      }
      joined = true;
    });
    socket.on('call:update', (p: CallUpdatePayload) => {
      if (p.profileId !== profileId) return;
      const seen = callsRef.current.some((c) => c.id === p.callId) || ringingRef.current.some((c) => c.id === p.callId);
      setCalls((prev) => upsertCall(prev, p, filterRef.current));
      setRinging((prev) => {
        const others = prev.filter((c) => c.id !== p.callId);
        return p.outcome === 'ringing' ? [fromPayload(p, prev.find((c) => c.id === p.callId)), ...others] : others;
      });
      if (!seen) {
        // The payload has no contact: the stored row of a call not shown yet has its chat (name, Open chat). Only those
        // relations are taken over, by id and never inserted: outcome and follow-up stay what the socket said, so a
        // call that ended meanwhile does not come back.
        void api.getCall(p.callId).then(({ data: stored }) => {
          if (!stored) return;
          const withChat = (c: CallRecord): CallRecord =>
            c.id !== p.callId ? c : { ...c, conversationId: stored.conversationId, conversation: stored.conversation, assignedUser: stored.assignedUserId === c.assignedUserId ? stored.assignedUser : c.assignedUser };
          setCalls((prev) => prev.map(withChat));
          setRinging((prev) => prev.map(withChat));
        });
      }
      // A call ended: a strip refetch (after an action, on a reconnect) read while it still rang is stale (auto-reject takes milliseconds) and must not bring it back.
      if (p.outcome !== 'ringing') ringingSeq.current++;
    });
    return () => {
      socket.disconnect();
    };
  }, [profileId]);

  const run = async (call: CallRecord, action: () => Promise<{ error?: string; data?: CallRecord | { call: CallRecord } }>, success: string) => {
    setBusy((b) => [...b, call.id]);
    const res = await action();
    setBusy((b) => b.filter((id) => id !== call.id));
    if (res.error) {
      toast({ title: 'Action failed', description: GATE_REASON[res.error] ?? res.error, variant: 'destructive' });
      void loaders.current.load(); // a 409 often means the row or the strip is out of date
      void loaders.current.loadRinging();
      return false;
    }
    toast({ title: success });
    // The answer is the stored row (relations included): apply it in place, so the pages already loaded stay.
    const row = res.data && ('call' in res.data ? res.data.call : res.data);
    if (row) setCalls((prev) => (matchesFilter(row, filterRef.current) ? prev.map((c) => (c.id === row.id ? row : c)) : prev.filter((c) => c.id !== row.id)));
    void loaders.current.loadRinging(); // realtime is the primary path; this covers a call:update the socket missed
    return true;
  };

  const openDialog = (kind: 'reply' | 'link' | 'assign', call: CallRecord) => {
    opener.current = document.activeElement as HTMLElement | null;
    const settings = profiles.find((p) => p.id === call.profileId)?.settings;
    setText(kind === 'reply' ? String(settings?.callReplyMessage ?? '') : '');
    setLinkType(call.isVideo ? 'video' : 'voice');
    setAssignee(call.assignedUserId ?? UNASSIGNED);
    setDialog({ kind, call, open: true });
  };
  const closeDialog = () => setDialog((d) => d && { ...d, open: false });

  const submitDialog = async () => {
    if (!dialog) return;
    const submitted = dialog;
    const { kind, call } = dialog;
    const ok =
      kind === 'reply'
        ? await run(call, () => api.replyToCall(call.id, text.trim() || undefined), 'Reply sent')
        : kind === 'link'
          ? await run(call, () => api.sendCallLink(call.id, linkType, text.trim() || undefined), 'Call link sent')
          : await run(call, () => api.updateCall(call.id, { assignedUserId: assignee === UNASSIGNED ? null : assignee }), 'Assignment saved');
    if (ok) setDialog((d) => (d === submitted ? { ...d, open: false } : d)); // not a dialog opened since
  };
  const sending = !!dialog && busy.includes(dialog.call.id);

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
                <Button size="sm" variant="destructive" disabled={busy.includes(call.id)} onClick={() => run(call, () => api.rejectCall(call.id), 'Call rejected')}>
                  {busy.includes(call.id) ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PhoneOff className="w-4 h-4" aria-hidden="true" />}
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
            const disabled = busy.includes(call.id);
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
                          <Link href={`/dashboard/chat?profile=${call.profileId}&conv=${call.conversationId}`} aria-label={`Open chat with ${callerLabel(call)}`}>
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

      <Dialog open={!!dialog?.open} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}>
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
                maxLength={4096}
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
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={sending || (dialog?.kind === 'reply' && !text.trim())} onClick={submitDialog}>
              {sending ? 'Sending…' : dialog?.kind === 'assign' ? 'Save' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
