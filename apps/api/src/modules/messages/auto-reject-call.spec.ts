// Tests for the shared auto-reject-call helper used by both engine-manager forks.
import { describe, it, expect, vi } from 'vitest';
import { handleAutoRejectCall } from '@multiwa/engine-runtime';

const call = { id: 'call-1', from: '628123@c.us' };

describe('handleAutoRejectCall', () => {
  it('does nothing when auto-reject is off', async () => {
    const rejectCall = vi.fn();
    const ok = await handleAutoRejectCall(call, { autoRejectCalls: false }, { rejectCall });
    expect(ok).toBe(false);
    expect(rejectCall).not.toHaveBeenCalled();
  });

  it('does nothing when there is no call id', async () => {
    const rejectCall = vi.fn();
    const ok = await handleAutoRejectCall({ from: 'x' }, { autoRejectCalls: true }, { rejectCall });
    expect(ok).toBe(false);
    expect(rejectCall).not.toHaveBeenCalled();
  });

  it('rejects the call (no reply) when enabled without a message', async () => {
    const rejectCall = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn();
    const ok = await handleAutoRejectCall(call, { autoRejectCalls: true }, { rejectCall, sendText });
    expect(ok).toBe(true);
    expect(rejectCall).toHaveBeenCalledWith('call-1');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('rejects and replies to the caller when a message is configured', async () => {
    const rejectCall = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    await handleAutoRejectCall(
      call,
      { autoRejectCalls: true, autoRejectCallMessage: '  Maaf, panggilan tidak dilayani.  ' },
      { rejectCall, sendText },
    );
    expect(rejectCall).toHaveBeenCalledWith('call-1');
    // trimmed message, sent to the caller
    expect(sendText).toHaveBeenCalledWith('628123@c.us', 'Maaf, panggilan tidak dilayani.');
  });

  it('still resolves true if the reply send throws (reject already succeeded)', async () => {
    const rejectCall = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockRejectedValue(new Error('send failed'));
    const warn = vi.fn();
    const ok = await handleAutoRejectCall(
      call,
      { autoRejectCalls: true, autoRejectCallMessage: 'hi' },
      { rejectCall, sendText, logger: { warn } },
    );
    expect(ok).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
