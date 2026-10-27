// BaileysAdapter call handling that can be exercised without a socket connection.
// The socket is replaced by a bare emitter (same idea as webjs-call-events.spec.ts), so
// nothing here connects to WhatsApp.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BaileysAdapter } from '@multiwa/engines';

const CALLER = '628111000111@s.whatsapp.net';

/** A Baileys call update, as `ev.emit('call', [update])` delivers it. */
const update = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'c1', from: CALLER, status, ...extra });

const wire = () => {
  const adapter = new BaileysAdapter() as any;
  const ev = new EventEmitter();
  adapter.socket = { ev, rejectCall: vi.fn().mockResolvedValue(undefined) };
  adapter.authState = { saveCreds: vi.fn() }; // setupEventHandlers registers it for creds.update
  adapter.config = { profileId: 'p1', onCall: vi.fn() };
  adapter.setupEventHandlers();
  const onCall = adapter.config.onCall;
  const states = () => onCall.mock.calls.map((c: any[]) => c[0].state);
  return { adapter, ev, socket: adapter.socket, onCall, states };
};

describe('BaileysAdapter.rejectCall', () => {
  it('rejects a call it saw offered, then forgets it', async () => {
    const adapter = new BaileysAdapter() as any;
    adapter.socket = { rejectCall: vi.fn().mockResolvedValue(undefined) };
    adapter.callFrom.set('c1', '628111000111@s.whatsapp.net');
    await adapter.rejectCall('c1');
    expect(adapter.socket.rejectCall).toHaveBeenCalledWith('c1', '628111000111@s.whatsapp.net');
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Call is not ringing any more');
  });

  it('fails loudly for a call it does not know, without touching the socket', async () => {
    const adapter = new BaileysAdapter() as any;
    adapter.socket = { rejectCall: vi.fn() };
    await expect(adapter.rejectCall('nope')).rejects.toThrow('Call is not ringing any more');
    expect(adapter.socket.rejectCall).not.toHaveBeenCalled();
  });

  it('propagates a failed reject and keeps the call, so it can be retried', async () => {
    const { adapter, ev, socket } = wire();
    ev.emit('call', [update('offer')]);
    socket.rejectCall.mockRejectedValueOnce(new Error('stream errored'));
    await expect(adapter.rejectCall('c1')).rejects.toThrow('stream errored');
    await expect(adapter.rejectCall('c1')).resolves.toBeUndefined();
    expect(socket.rejectCall).toHaveBeenCalledTimes(2);
    expect(socket.rejectCall).toHaveBeenLastCalledWith('c1', CALLER);
  });

  it('says the client is not ready, not that the call stopped, while the socket is gone', async () => {
    const { adapter, ev } = wire();
    ev.emit('call', [update('offer')]);
    adapter.socket = null; // connect() nulls it while reconnecting
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Client not ready');
  });
});

describe('BaileysAdapter call updates', () => {
  it('reports the life of a call: ringing with the offer, then accepted, then ended', () => {
    const { ev, onCall, states } = wire();
    ev.emit('call', [update('offer', { isVideo: true })]);
    ev.emit('call', [update('accept', { isVideo: true })]);
    ev.emit('call', [update('terminate', { isVideo: true })]);
    expect(onCall).toHaveBeenNthCalledWith(1, { id: 'c1', from: CALLER, isVideo: true, isGroup: false, state: 'ringing' });
    expect(states()).toEqual(['ringing', 'accepted', 'ended']);
  });

  it('reports a ring-out as missed and a decline as rejected', () => {
    const { ev, states } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update('timeout')]);
    ev.emit('call', [update('offer', { id: 'c2' })]);
    ev.emit('call', [update('reject', { id: 'c2' })]);
    expect(states()).toEqual(['ringing', 'missed', 'ringing', 'rejected']);
  });

  it("ignores Baileys' catch-all `ringing` status without forgetting the call", async () => {
    const { adapter, ev, socket, states } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update('ringing'), update('relaylatency')]);
    expect(states()).toEqual(['ringing']); // the offer only
    await adapter.rejectCall('c1');
    expect(socket.rejectCall).toHaveBeenCalledWith('c1', CALLER);
  });

  it('skips an update without a call id, and an offer without a caller, without using up the id', () => {
    const { ev, onCall, states } = wire();
    ev.emit('call', [null, update('offer', { id: undefined }), update('terminate', { id: undefined })]);
    ev.emit('call', [update('offer', { from: undefined })]);
    expect(onCall).not.toHaveBeenCalled();
    ev.emit('call', [update('offer')]); // the same id, this time with a caller
    expect(states()).toEqual(['ringing']);
  });

  it('takes isGroup from the Baileys flag, or from a group caller JID', () => {
    const { ev, onCall } = wire();
    ev.emit('call', [update('offer', { id: 'g1', isGroup: true })]);
    ev.emit('call', [update('offer', { id: 'g2', from: '120363000000000000@g.us' })]);
    ev.emit('call', [update('offer', { id: 'p1' })]);
    expect(onCall.mock.calls.map((c: any[]) => c[0].isGroup)).toEqual([true, true, false]);
  });

  it('ignores the updates of a socket that connect() has replaced', () => {
    const { adapter, ev, onCall } = wire();
    adapter.socket = { ev: new EventEmitter() };
    ev.emit('call', [update('offer')]);
    expect(onCall).not.toHaveBeenCalled();
  });

  it('reports an offer once however often Baileys repeats it', () => {
    const { ev, states } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update('offer')]); // `offer_notice`, or a redelivery
    expect(states()).toEqual(['ringing']);
  });

  it('does not turn a replayed offer into a new call once the call has ended', async () => {
    const { adapter, ev, socket, states } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update('terminate')]);
    ev.emit('call', [update('offer')]);
    expect(states()).toEqual(['ringing', 'ended']);
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Call is not ringing any more');
    expect(socket.rejectCall).not.toHaveBeenCalled();
  });

  it('still remembers a reported offer after a reconnect gave the adapter a new socket', () => {
    const { adapter, ev, onCall } = wire();
    ev.emit('call', [update('offer')]);
    const next = new EventEmitter();
    adapter.socket = { ev: next, rejectCall: vi.fn() };
    adapter.setupEventHandlers(); // what connect() does for the new socket
    next.emit('call', [update('offer')]); // the unacked stanza, redelivered
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('bounds what it remembers: forgets the oldest offers first, never the newest', () => {
    const { ev, onCall } = wire();
    for (let i = 0; i < 600; i++) ev.emit('call', [update('offer', { id: `c${i}` })]);
    ev.emit('call', [update('offer', { id: 'c599' })]); // still remembered: a repeat
    expect(onCall).toHaveBeenCalledTimes(600);
    ev.emit('call', [update('offer', { id: 'c0' })]); // fell out of the window, so it is reported again
    expect(onCall).toHaveBeenCalledTimes(601);
  });

  it.each(['accept', 'reject'])('forgets a call once it was %sed: rejectCall no longer reaches the socket', async (status) => {
    const { adapter, ev, socket } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update(status)]);
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Call is not ringing any more');
    expect(socket.rejectCall).not.toHaveBeenCalled();
  });

  it("reports a follow-up that lacks the caller with the offer's caller, and forgets the call", async () => {
    const { adapter, ev, socket, onCall } = wire();
    ev.emit('call', [update('offer')]);
    ev.emit('call', [update('terminate', { from: undefined })]);
    expect(onCall).toHaveBeenLastCalledWith({ id: 'c1', from: CALLER, isVideo: false, isGroup: false, state: 'ended' });
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Call is not ringing any more');
    expect(socket.rejectCall).not.toHaveBeenCalled();
  });

  it('reports a follow-up for a call it never saw offered, with an empty caller', () => {
    const { ev, onCall } = wire();
    ev.emit('call', [{ id: 'c9', status: 'terminate' }]); // e.g. the offer came before a restart
    expect(onCall).toHaveBeenCalledWith({ id: 'c9', from: '', isVideo: false, isGroup: false, state: 'ended' });
  });
});
