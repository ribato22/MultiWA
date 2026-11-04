// ApiKeysController: a key is made by a person who signed in, never by another key. A key limited to a few scopes
// could otherwise make itself one with no limit.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { ApiKeysController } from './api-keys.controller';

describe('ApiKeysController.create', () => {
  const service = { create: vi.fn() };
  const audit = { log: vi.fn() };
  let controller: ApiKeysController;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.log.mockResolvedValue(undefined);
    controller = new ApiKeysController(service as any, audit as any);
  });

  it('refuses a request made with an API key, and creates nothing', async () => {
    const req = { user: { id: 'u1', apiKeyId: 'key-1', apiKeyScopes: ['messages:read'] }, headers: {} };
    await expect(controller.create(req, { name: 'wider', permissions: [] })).rejects.toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('creates the key for a signed-in user', async () => {
    service.create.mockResolvedValueOnce({ id: 'key-2', key: 'mwa_live_x' });
    const req = { user: { id: 'u1' }, headers: {}, ip: '127.0.0.1' };
    await expect(controller.create(req, { name: 'crm', permissions: ['messages:read'], expiresInDays: 30 })).resolves.toEqual({ id: 'key-2', key: 'mwa_live_x' });
    expect(service.create).toHaveBeenCalledWith('u1', 'crm', ['messages:read'], 30);
  });
});
