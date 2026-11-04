// AuthService Unit Tests
// Tests core authentication logic with mocked dependencies

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Mock Prisma — factory creates fresh mock functions
vi.mock('@multiwa/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    workspace: {
      create: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('./server-owner', () => ({
  isServerOwner: vi.fn().mockResolvedValue(false),
  assertServerOwnerMayLeave: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@multiwa/database';
import { assertServerOwnerMayLeave, isServerOwner } from './server-owner';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  const mockJwtService = {
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn(),
    decode: vi.fn(),
  };
  const mockTwoFactorService = {
    verifyTwoFactor: vi.fn(),
  };
  const mockSessionsService = {
    createSession: vi.fn(),
    removeSessionByToken: vi.fn(),
  };
  let allowRegistration: string | undefined;
  const mockConfigService = {
    // refresh-token secret + ttl (defaults mirror ConfigService.get(key, default))
    get: vi.fn((key: string, def?: unknown) => {
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      if (key === 'ALLOW_REGISTRATION') return allowRegistration;
      return def;
    }),
  };

  beforeEach(() => {
    // Reset all mocks — clears call history AND resets implementations
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.delete).mockReset();
    vi.mocked(prisma.user.count).mockReset().mockResolvedValue(0 as any);
    vi.mocked(prisma.organization.create).mockReset();
    vi.mocked(prisma.organization.delete).mockReset();
    vi.mocked(prisma.workspace.create).mockReset();
    vi.mocked(prisma.account.create).mockReset();
    vi.mocked(prisma.refreshToken.create).mockReset().mockResolvedValue({} as any);
    vi.mocked(prisma.refreshToken.findUnique).mockReset();
    vi.mocked(prisma.refreshToken.update).mockReset().mockResolvedValue({} as any);
    vi.mocked(prisma.refreshToken.updateMany).mockReset().mockResolvedValue({ count: 0 } as any);

    mockJwtService.sign.mockReset().mockReturnValue('mock-token');
    mockJwtService.verify.mockReset();
    mockJwtService.decode.mockReset();
    mockSessionsService.createSession.mockReset();
    mockSessionsService.removeSessionByToken.mockReset();
    mockTwoFactorService.verifyTwoFactor.mockReset();

    mockConfigService.get.mockClear();
    allowRegistration = undefined;
    // Calls only: the factory's default answers stay.
    vi.mocked(isServerOwner).mockClear();
    vi.mocked(assertServerOwnerMayLeave).mockClear();

    authService = new AuthService(
      mockJwtService as any,
      mockTwoFactorService as any,
      mockSessionsService as any,
      mockConfigService as any,
    );
  });

  // ──────────── register ────────────
  describe('register', () => {
    it('should throw ConflictException if email already exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'existing' } as any);

      await expect(
        authService.register({
          email: 'test@test.com',
          password: 'password123',
          name: 'Test',
          organizationName: 'TestOrg',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create organization, workspace, and user on successful registration', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.organization.create).mockResolvedValueOnce({ id: 'org-1' } as any);
      vi.mocked(prisma.workspace.create).mockResolvedValueOnce({ id: 'ws-1' } as any);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        role: 'owner',
        organizationId: 'org-1',
      } as any);

      const result = await authService.register({
        email: 'test@test.com',
        password: 'password123',
        name: 'Test',
        organizationName: 'TestOrg',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(prisma.organization.create).toHaveBeenCalledOnce();
      expect(prisma.workspace.create).toHaveBeenCalledOnce();
      expect(prisma.user.create).toHaveBeenCalledOnce();
    });

    it('refuses a registration once the server has its owner, unless ALLOW_REGISTRATION=true', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(1 as any);
      await expect(
        authService.register({ email: 'late@test.com', password: 'password123', name: 'Late', organizationName: 'LateOrg' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.organization.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled(); // a closed registration tells nothing about who exists
    });

    it('opens registration for the first user', async () => {
      await expect(authService.registrationOpen()).resolves.toBe(true); // count 0
    });

    // One user: the owner alone, as on every server just set up.
    describe('once the server has its owner', () => {
      beforeEach(() => vi.mocked(prisma.user.count).mockResolvedValue(1 as any));

      // Exactly 'true': .env.example sets 'false', which a truthy parse would open.
      it.each([undefined, 'false', 'TRUE', '1', ' true'])('keeps registration closed with ALLOW_REGISTRATION=%j', async (value) => {
        allowRegistration = value;
        await expect(authService.registrationOpen()).resolves.toBe(false);
      });

      it('opens registration with ALLOW_REGISTRATION=true', async () => {
        allowRegistration = 'true';
        await expect(authService.registrationOpen()).resolves.toBe(true);
      });
    });

    it("the sign-in answer's user says whether they are the server's owner", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.organization.create).mockResolvedValueOnce({ id: 'org-1' } as any);
      vi.mocked(prisma.workspace.create).mockResolvedValueOnce({ id: 'ws-1' } as any);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: 'u1', email: 'first@test.com', name: 'First', role: 'owner', organizationId: 'org-1' } as any);
      vi.mocked(isServerOwner).mockResolvedValueOnce(true);
      const result = await authService.register({ email: 'first@test.com', password: 'password123', name: 'First', organizationName: 'FirstOrg' });
      expect(result.user).toMatchObject({ id: 'u1', role: 'owner', isServerOwner: true });
    });
  });

  // ──────────── login ────────────
  describe('login', () => {
    it('should throw UnauthorizedException for wrong email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(
        authService.login({ email: 'wrong@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: hash,
        twoFactorEnabled: false,
        organization: { id: 'org-1' },
      } as any);

      await expect(
        authService.login({ email: 'test@test.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return requires2FA when 2FA is enabled', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: hash,
        twoFactorEnabled: true,
        organization: { id: 'org-1' },
      } as any);

      const result = await authService.login({ email: 'test@test.com', password: 'password123' });

      expect(result).toEqual({ requires2FA: true, userId: 'user-1' });
    });

    it('should return tokens on successful login', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        role: 'owner',
        organizationId: 'org-1',
        passwordHash: hash,
        twoFactorEnabled: false,
        organization: { id: 'org-1', name: 'TestOrg' },
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any);

      const result = await authService.login({ email: 'test@test.com', password: 'password123' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockSessionsService.createSession).toHaveBeenCalledOnce();
    });
  });

  // ──────────── changePassword ────────────
  describe('changePassword', () => {
    it('should throw BadRequestException for wrong current password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);

      await expect(
        authService.changePassword('user-1', 'wrongpassword', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for short new password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);

      await expect(
        authService.changePassword('user-1', 'oldpassword', 'short'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully change password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any);

      const result = await authService.changePassword('user-1', 'oldpassword', 'newpassword123');

      expect(result).toEqual({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );
    });
  });

  // ──────────── getProfile ────────────
  describe('getProfile', () => {
    it('should throw if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(authService.getProfile('nonexistent')).rejects.toThrow(UnauthorizedException);
    });

    it('should return profile without sensitive fields', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        passwordHash: 'secret',
        twoFactorSecret: 'secret',
        twoFactorEnabled: false,
        backupCodes: [],
        organization: { id: 'org-1' },
      } as any);

      const profile = await authService.getProfile('user-1');

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('twoFactorSecret');
      expect(profile).toHaveProperty('email', 'test@test.com');
    });

    it("getProfile says whether the caller is the server's owner, for the dashboard's server settings", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', role: 'owner', organizationId: 'org-1', passwordHash: 'h', twoFactorSecret: null, backupCodes: [], twoFactorEnabled: false, organization: { id: 'org-1' } } as any);
      vi.mocked(isServerOwner).mockResolvedValueOnce(true);
      const me = await authService.getProfile('u1');
      expect(me).toMatchObject({ id: 'u1', isServerOwner: true });
      expect(me).not.toHaveProperty('passwordHash');
      expect(isServerOwner).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner', organizationId: 'org-1' }));
    });
  });

  // ──────────── deleteAccount ────────────
  describe('deleteAccount', () => {
    it("refuses the server's owner while other organizations use the server, and deletes nothing", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', role: 'owner', organizationId: 'org-1', passwordHash: await bcrypt.hash('pw', 4) } as any);
      vi.mocked(assertServerOwnerMayLeave).mockRejectedValueOnce(new ForbiddenException("The server's owner cannot delete their account while other organizations use this server"));
      await expect(authService.deleteAccount('u1', 'pw')).rejects.toThrow(ForbiddenException);
      expect(prisma.organization.delete).not.toHaveBeenCalled();
    });

    it('an owner who may leave deletes their organization', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', role: 'owner', organizationId: 'org-1', passwordHash: await bcrypt.hash('pw', 4) } as any);
      vi.mocked(prisma.organization.delete).mockResolvedValueOnce({} as any);
      await expect(authService.deleteAccount('u1', 'pw')).resolves.toEqual({ success: true });
      expect(assertServerOwnerMayLeave).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner', organizationId: 'org-1' }));
      expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    });
  });
});
