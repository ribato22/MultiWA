// MessagesService Unit Tests — the core send path's input handling: poll
// validation, reaction/reply target lookup, and per-type payload construction.
// Prisma is mocked and the private queueMessage is stubbed for the delegation
// cases, so these run without a database.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    message: { findUnique: vi.fn(), findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';

function makeService(): MessagesService {
  // The constructor only stores its deps; none are touched on the paths tested
  // below, so empty stubs are sufficient.
  return new MessagesService(
    {} as any, // engineManager
    {} as any, // sendGate
    {} as any, // eventEmitter
    {} as any, // outboundQueue
    {} as any, // engineCommands
  );
}

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(() => {
    vi.mocked(prisma.message.findUnique).mockReset();
    service = makeService();
  });

  describe('sendPoll validation', () => {
    it('rejects fewer than 2 options', async () => {
      await expect(
        service.sendPoll({ profileId: 'p', to: '628', question: 'Q', options: ['only'] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects more than 12 options', async () => {
      const options = Array.from({ length: 13 }, (_, i) => `opt${i}`);
      await expect(
        service.sendPoll({ profileId: 'p', to: '628', question: 'Q', options } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts 2..12 options and delegates a poll payload', async () => {
      const spy = vi.fn().mockResolvedValue({ status: 'queued' });
      (service as any).queueMessage = spy;
      await service.sendPoll({
        profileId: 'p',
        to: '628',
        question: 'Q',
        options: ['a', 'b'],
        allowMultipleAnswers: true,
      } as any);
      expect(spy).toHaveBeenCalledWith(
        'p',
        '628',
        'poll',
        expect.objectContaining({ question: 'Q', options: ['a', 'b'], allowMultipleAnswers: true }),
      );
    });
  });

  describe('reaction / reply target lookup', () => {
    it('sendReaction throws NotFound when the target message is missing', async () => {
      vi.mocked(prisma.message.findUnique).mockResolvedValueOnce(null);
      await expect(
        service.sendReaction({ profileId: 'p', messageId: 'missing', emoji: '👍' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('sendReply throws NotFound when the quoted message is missing', async () => {
      vi.mocked(prisma.message.findUnique).mockResolvedValueOnce(null);
      await expect(
        service.sendReply({ profileId: 'p', quotedMessageId: 'missing', text: 'hi' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('send-method payload construction (delegates to queueMessage)', () => {
    let spy: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      spy = vi.fn().mockResolvedValue({ status: 'queued' });
      (service as any).queueMessage = spy;
    });

    it('sendText builds a text payload (with an undefined quote by default)', async () => {
      await service.sendText({ profileId: 'p', to: '628', text: 'hello' } as any);
      expect(spy).toHaveBeenCalledWith('p', '628', 'text', { text: 'hello' }, undefined);
    });

    it('sendImage defaults the mimetype to image/jpeg', async () => {
      await service.sendImage({ profileId: 'p', to: '628', url: 'http://x/y.jpg' } as any);
      expect(spy).toHaveBeenCalledWith(
        'p',
        '628',
        'image',
        expect.objectContaining({ url: 'http://x/y.jpg', mimetype: 'image/jpeg' }),
      );
    });

    it('sendAudio marks it a non-ptt audio/mpeg by default', async () => {
      await service.sendAudio({ profileId: 'p', to: '628', url: 'http://x/a.mp3' } as any);
      expect(spy).toHaveBeenCalledWith(
        'p',
        '628',
        'audio',
        expect.objectContaining({ ptt: false, mimetype: 'audio/mpeg' }),
      );
    });
  });

  // ?limit=1000000 would load a whole table into one answer: a page is at most 1000 rows, and a full one says there is
  // more, whatever limit was asked for.
  describe('message lists', () => {
    it('load at most 1000 rows, and a full page has more', async () => {
      const findMany = vi.mocked(prisma.message.findMany).mockReset().mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}` })) as any);
      await service.findByProfile('p', { limit: 1_000_000 });
      expect(findMany.mock.calls[0][0]).toMatchObject({ take: 1000 });
      expect((await service.findByConversation('c', { limit: 1_000_000 })).hasMore).toBe(true);
      expect(findMany.mock.calls[1][0]).toMatchObject({ take: 1000 });
    });
  });
});
