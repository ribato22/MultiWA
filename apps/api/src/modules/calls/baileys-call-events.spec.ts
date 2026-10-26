// BaileysAdapter call handling that can be exercised without a socket connection.
import { describe, it, expect, vi } from 'vitest';
import { BaileysAdapter } from '@multiwa/engines';

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
});
