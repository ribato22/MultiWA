// JwtStrategy: the user a signed-in request carries never holds the organization's customer lookup secret.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { JwtStrategy } from './jwt.strategy';

const config = { getOrThrow: () => 'test-jwt-secret' } as any;
const sessions = { validateAndTouch: vi.fn().mockResolvedValue(true) } as any;

describe('JwtStrategy', () => {
  it("does not carry the organization's customer lookup secret", async () => {
    (prisma as any).user.findUnique.mockResolvedValue({
      id: 'u1', email: 'viewer@example.com', name: 'Vera', role: 'viewer', organizationId: 'o1', isActive: true,
      organization: { id: 'o1', settings: { theme: 'dark', customers: { idLabel: 'ID Pelanggan', lookupSecretEnc: 'iv:tag:data' } } },
    });
    const user = await new JwtStrategy(config, sessions).validate({ headers: { authorization: 'Bearer t' } }, { sub: 'u1' } as any);
    expect(JSON.stringify(user)).not.toContain('lookupSecretEnc');
    expect(user.organization.settings).toEqual({ theme: 'dark', customers: { idLabel: 'ID Pelanggan' } });
  });
});
