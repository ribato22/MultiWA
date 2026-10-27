// EngineCommandProcessor: the two call commands the API sends to the worker-hosted engine.
// Only the message of a failed job crosses BullMQ (failedReason), and the API maps it to an HTTP
// status by its text (CALL_NOT_FOUND -> 404, CALL_NOT_RINGING / "not connected" -> 409), so the
// processor must hand the manager's and the engine's errors on exactly as they are.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));

import { EngineCommandProcessor } from './engine-command-processor';

const job = (name: string, data: Record<string, unknown>): any => ({ name, data });

describe('EngineCommandProcessor call commands', () => {
  describe('reject-call', () => {
    it('delegates to the engine manager with the call id', async () => {
      const engineManager = { rejectCallByAgent: vi.fn().mockResolvedValue({ callId: 'c1' }) };
      const p = new EngineCommandProcessor(engineManager as any);
      await expect(p.process(job('reject-call', { profileId: 'p1', callId: 'c1' }))).resolves.toEqual({ callId: 'c1' });
      expect(engineManager.rejectCallByAgent).toHaveBeenCalledWith('p1', 'c1');
    });

    // The runtime's coded errors (and the manager's own ENGINE_NOT_CONNECTED) reach the API as the job's failedReason.
    it.each(['CALL_NOT_FOUND', 'CALL_NOT_RINGING', 'ENGINE_NOT_CONNECTED'])('%s from the manager propagates unchanged', async (code) => {
      const err = new Error(`${code}: c1`);
      const engineManager = { rejectCallByAgent: vi.fn().mockRejectedValue(err) };
      const p = new EngineCommandProcessor(engineManager as any);
      const failure = await p.process(job('reject-call', { profileId: 'p1', callId: 'c1' })).catch((e) => e);
      expect(failure).toBe(err);
      expect((failure as Error).message.startsWith(`${code}:`)).toBe(true);
    });
  });

  describe('create-call-link', () => {
    it('asks the profile engine for a link', async () => {
      const engine = { createCallLink: vi.fn().mockResolvedValue('https://call.whatsapp.com/video/x') };
      const p = new EngineCommandProcessor({ getEngine: vi.fn().mockReturnValue(engine) } as any);
      await expect(p.process(job('create-call-link', { profileId: 'p1', type: 'video' }))).resolves.toBe('https://call.whatsapp.com/video/x');
      expect(engine.createCallLink).toHaveBeenCalledWith('video');
    });

    it('fails clearly when the profile is not connected', async () => {
      const getEngine = vi.fn().mockReturnValue(null);
      const p = new EngineCommandProcessor({ getEngine } as any);
      const failure = await p.process(job('create-call-link', { profileId: 'p1', type: 'voice' })).catch((e) => e);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/not connected/);
      expect((failure as Error & { code?: string }).code).toBe('ENGINE_NOT_CONNECTED');
      expect(getEngine).toHaveBeenCalledWith('p1');
    });

    // An engine without a call-link API (Baileys 6.x) answers null: what that means is the API layer's call, not the worker's.
    it('hands a null link back when the engine has no call-link API', async () => {
      const engine = { createCallLink: vi.fn().mockResolvedValue(null) };
      const p = new EngineCommandProcessor({ getEngine: vi.fn().mockReturnValue(engine) } as any);
      await expect(p.process(job('create-call-link', { profileId: 'p1', type: 'voice' }))).resolves.toBeNull();
      expect(engine.createCallLink).toHaveBeenCalledWith('voice');
    });

    it('propagates what the engine throws unchanged', async () => {
      const err = new Error('WhatsApp did not return a call link');
      const engine = { createCallLink: vi.fn().mockRejectedValue(err) };
      const p = new EngineCommandProcessor({ getEngine: vi.fn().mockReturnValue(engine) } as any);
      await expect(p.process(job('create-call-link', { profileId: 'p1', type: 'video' }))).rejects.toBe(err);
    });
  });
});
