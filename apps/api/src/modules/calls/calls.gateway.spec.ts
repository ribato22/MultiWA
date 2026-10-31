// The call commands on /ws: each one runs as the socket's principal (EventsGateway authenticated it) and is always
// answered, also for an unauthenticated socket or a command that throws.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';

vi.mock('./coordinator/call-session.service', () => ({ CallSessionService: class {} }));
vi.mock('../events/events.gateway', () => ({ EventsGateway: class {}, WS_GATEWAY_OPTIONS: { namespace: '/ws' } }));

import { CallsGateway } from './calls.gateway';

const principal = { userId: 'u1', organizationId: 'o1' };
const socket = {} as any;
function make(auth: unknown = principal) {
  const events = { authOf: vi.fn(async () => auth) };
  const sessions = {
    answer: vi.fn(async () => ({ ok: true })),
    media: vi.fn(async () => ({ ok: true, result: null })),
    rejoin: vi.fn(async () => ({ ok: true })),
    hangup: vi.fn(async () => ({ ok: true })),
    setAvailability: vi.fn(async () => ({ ok: true, available: false })),
  };
  return { gateway: new CallsGateway(events as any, sessions as any), events, sessions };
}

describe('CallsGateway', () => {
  it('subscribes the five call commands', () => {
    const proto = CallsGateway.prototype as any;
    expect(['answer', 'media', 'rejoin', 'hangup', 'availability'].map((m) => Reflect.getMetadata(MESSAGE_METADATA, proto[m]))).toEqual([
      'call:answer', 'call:media', 'call:rejoin', 'call:hangup', 'call:availability',
    ]);
  });

  it("runs every command as the socket's principal", async () => {
    const { gateway, sessions } = make();
    await gateway.answer(socket, { callId: 'c1' });
    await gateway.media(socket, { callId: 'c1', op: 'produce', kind: 'audio' });
    await gateway.rejoin(socket, { callId: 'c1' });
    await gateway.hangup(socket, { callId: 'c1' });
    await gateway.availability(socket, { available: false });
    expect(sessions.answer).toHaveBeenCalledWith(principal, 'c1');
    expect(sessions.media).toHaveBeenCalledWith(principal, 'c1', 'produce', { callId: 'c1', op: 'produce', kind: 'audio' });
    expect(sessions.rejoin).toHaveBeenCalledWith(principal, 'c1');
    expect(sessions.hangup).toHaveBeenCalledWith(principal, 'c1');
    expect(sessions.setAvailability).toHaveBeenCalledWith(principal, false);
  });

  it('an unauthenticated socket is answered not_allowed; a command that throws, error; a missing body is no crash', async () => {
    const anon = make(null);
    expect(await anon.gateway.answer(socket, { callId: 'c1' })).toEqual({ ok: false, reason: 'not_allowed' });
    expect(anon.sessions.answer).not.toHaveBeenCalled();
    const { gateway, sessions } = make();
    sessions.hangup.mockRejectedValueOnce(new Error('boom'));
    expect(await gateway.hangup(socket, { callId: 'c1' })).toEqual({ ok: false, reason: 'error' });
    await gateway.answer(socket, undefined as any);
    expect(sessions.answer).toHaveBeenCalledWith(principal, undefined);
  });
});
