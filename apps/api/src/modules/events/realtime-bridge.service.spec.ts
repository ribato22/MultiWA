// RealtimeBridgeService.handle unit tests — proves each realtime channel message
// is re-emitted through the correct EventsGateway method (no Redis needed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealtimeBridgeService } from './realtime-bridge.service';

function makeBridge() {
  const eventsGateway = {
    emitQrUpdate: vi.fn(),
    emitConnectionStatus: vi.fn(),
    emitMessage: vi.fn(),
    emitMessageAck: vi.fn(),
  };
  const config = { get: vi.fn() };
  const svc = new RealtimeBridgeService(config as any, eventsGateway as any);
  return { svc, eventsGateway };
}

describe('RealtimeBridgeService.handle', () => {
  let bridge: ReturnType<typeof makeBridge>;
  beforeEach(() => {
    bridge = makeBridge();
  });

  it('re-emits qr:update', () => {
    bridge.svc.handle(JSON.stringify({ type: 'qr:update', profileId: 'p1', payload: { qrCode: 'data:img' } }));
    expect(bridge.eventsGateway.emitQrUpdate).toHaveBeenCalledWith('p1', 'data:img');
  });

  it('re-emits connection:status with phoneOrReason', () => {
    bridge.svc.handle(JSON.stringify({ type: 'connection:status', profileId: 'p1', payload: { status: 'connected', phoneOrReason: '628' } }));
    expect(bridge.eventsGateway.emitConnectionStatus).toHaveBeenCalledWith('p1', 'connected', '628');
  });

  it('re-emits message', () => {
    const payload = { message: { id: 'm1' }, conversation: { id: 'c1' } };
    bridge.svc.handle(JSON.stringify({ type: 'message', profileId: 'p1', payload }));
    expect(bridge.eventsGateway.emitMessage).toHaveBeenCalledWith('p1', payload);
  });

  it('re-emits message:ack', () => {
    bridge.svc.handle(JSON.stringify({ type: 'message:ack', profileId: 'p1', payload: { messageId: 'm1', status: 'read' } }));
    expect(bridge.eventsGateway.emitMessageAck).toHaveBeenCalledWith('p1', 'm1', 'read');
  });

  it('tracks heartbeat without emitting anything', () => {
    bridge.svc.handle(JSON.stringify({ type: 'heartbeat', profileId: '*', payload: { ts: 123, workerPid: 9 } }));
    expect(bridge.eventsGateway.emitQrUpdate).not.toHaveBeenCalled();
    expect(bridge.eventsGateway.emitMessage).not.toHaveBeenCalled();
  });

  it('drops malformed payloads without throwing', () => {
    expect(() => bridge.svc.handle('not-json{')).not.toThrow();
    expect(bridge.eventsGateway.emitMessage).not.toHaveBeenCalled();
  });
});
