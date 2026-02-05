// PushService Unit Tests
// Tests push notification subscription management and delivery

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as webpush from 'web-push';

// Mock web-push
vi.mock('web-push', () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  generateVAPIDKeys: vi.fn().mockReturnValue({
    publicKey: 'mock-public-key-base64',
    privateKey: 'mock-private-key-base64',
  }),
}));

// Mock Prisma
vi.mock('@multiwa/database', () => ({
  prisma: {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@multiwa/database';
import { PushService } from './push.service';

describe('PushService', () => {
  let pushService: PushService;

  beforeEach(() => {
    vi.clearAllMocks();
    pushService = new PushService();
  });

  describe('subscribe', () => {
    it('should save a push subscription via upsert', async () => {
      vi.mocked(prisma.pushSubscription.upsert).mockResolvedValue({} as any);

      await pushService.subscribe('user-1', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'key1', auth: 'key2' },
      });

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
          create: expect.objectContaining({
            userId: 'user-1',
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            p256dh: 'key1',
            auth: 'key2',
          }),
        }),
      );
    });
  });

  describe('unsubscribe', () => {
    it('should remove a push subscription by userId and endpoint', async () => {
      vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValue({ count: 1 });

      await pushService.unsubscribe('user-1', 'https://fcm.googleapis.com/fcm/send/abc');

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        },
      });
    });
  });

  describe('hasSubscription', () => {
    it('should return true when user has subscriptions', async () => {
      vi.mocked(prisma.pushSubscription.count).mockResolvedValue(2);

      const result = await pushService.hasSubscription('user-1');

      expect(result).toBe(true);
    });

    it('should return false when user has no subscriptions', async () => {
      vi.mocked(prisma.pushSubscription.count).mockResolvedValue(0);

      const result = await pushService.hasSubscription('user-1');

      expect(result).toBe(false);
    });
  });

  describe('getSubscriptions', () => {
    it('should return all subscriptions for a user', async () => {
      const mockSubs = [
        { id: 'sub-1', endpoint: 'https://fcm.googleapis.com/1', p256dh: 'k1', auth: 'a1' },
        { id: 'sub-2', endpoint: 'https://fcm.googleapis.com/2', p256dh: 'k2', auth: 'a2' },
      ];
      vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue(mockSubs as any);

      const result = await pushService.getSubscriptions('user-1');

      expect(result).toHaveLength(2);
      expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: expect.any(Object),
      });
    });

    it('should return empty array for user with no subscriptions', async () => {
      vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue([]);

      const result = await pushService.getSubscriptions('user-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('sendPush', () => {
    it('should return 0 if no subscriptions found', async () => {
      vi.mocked(prisma.pushSubscription.findMany).mockResolvedValue([]);

      const result = await pushService.sendPush('user-1', 'Test', 'Hello');

      expect(result).toBe(0);
    });
  });

  describe('enabled', () => {
    it('should return false when not configured', () => {
      // A freshly created instance should not be configured
      expect(pushService.enabled).toBe(false);
    });
  });
});
