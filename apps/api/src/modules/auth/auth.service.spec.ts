// AuthService Unit Tests
// Tests core authentication logic with mocked dependencies

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SessionsService } from './sessions.service';

// Mock Prisma — factory creates fresh mock functions
vi.mock('@multiwa/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
  },
}));

import { prisma } from '@multiwa/database';

/** User fields used by AuthService mocks — no @prisma/client dependency. */
interface TestUser {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  isActive: boolean;
  preferences: Record<string, unknown>;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  twoFactorSecret: string | null;
  twoFactorEnabled: boolean;
  backupCodes: string[];
}


type UserWithOrg = TestUser & { organization?: { id: string; name?: string } };

function userStub(partial: Partial<UserWithOrg> & Pick<TestUser, 'id'>): UserWithOrg {
  return {
    organizationId: 'org-1',
    email: 'test@example.com',
    passwordHash: '',
    name: 'Test',
    role: 'member',
    isActive: true,
    preferences: {},
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    twoFactorSecret: null,
    twoFactorEnabled: false,
    backupCodes: [],
    ...partial,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  const mockJwtService = {
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn(),
  };
  const mockTwoFactorService = {
    verifyTwoFactor: vi.fn(),
  };
  const mockSessionsService = {
    createSession: vi.fn(),
    removeSessionByToken: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.delete).mockReset();
    vi.mocked(prisma.organization.create).mockReset();
    vi.mocked(prisma.organization.delete).mockReset();
    vi.mocked(prisma.workspace.create).mockReset();
    vi.mocked(prisma.account.create).mockReset();

    mockJwtService.sign.mockReset().mockReturnValue('mock-token');
    mockJwtService.verify.mockReset();
    mockSessionsService.createSession.mockReset();
    mockSessionsService.removeSessionByToken.mockReset();
    mockTwoFactorService.verifyTwoFactor.mockReset();

    // Test doubles for Nest providers — partial mocks, cast at DI boundary only.
    authService = new AuthService(
      mockJwtService as unknown as JwtService,
      mockTwoFactorService as unknown as TwoFactorService,
      mockSessionsService as unknown as SessionsService,
    );
  });

  // ──────────── register ────────────
  describe('register', () => {
    it('should throw ConflictException if email already exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userStub({ id: 'existing' }));

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test',
          organizationName: 'TestOrg',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create organization, workspace, and user on successful registration', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.organization.create).mockResolvedValueOnce({
        id: 'org-1',
        name: 'TestOrg',
        slug: 'testorg',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {},
      });
      vi.mocked(prisma.workspace.create).mockResolvedValueOnce({
        id: 'ws-1',
        organizationId: 'org-1',
        name: 'Default',
        slug: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {},
      });
      vi.mocked(prisma.user.create).mockResolvedValueOnce(
        userStub({
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test',
          role: 'owner',
          organizationId: 'org-1',
        }),
      );

      const result = await authService.register(
        {
          email: 'test@example.com',
          password: 'password123',
          name: 'Test',
          organizationName: 'TestOrg',
        },
        '203.0.113.10',
        'TestBrowser/1.0',
      );

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(prisma.organization.create).toHaveBeenCalledOnce();
      expect(prisma.workspace.create).toHaveBeenCalledOnce();
      expect(prisma.user.create).toHaveBeenCalledOnce();
      expect(mockSessionsService.createSession).toHaveBeenCalledWith(
        'user-1',
        'mock-token',
        '203.0.113.10',
        'TestBrowser/1.0',
      );
    });
  });

  // ──────────── refreshToken ────────────
  describe('refreshToken', () => {
    it('should verify refresh tokens with JWT_REFRESH_SECRET fallback to JWT_SECRET', async () => {
      const prevRefresh = process.env.JWT_REFRESH_SECRET;
      const prevSecret = process.env.JWT_SECRET;
      process.env.JWT_REFRESH_SECRET = 'refresh-only-secret';
      process.env.JWT_SECRET = 'access-secret';

      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({ id: 'user-1', isActive: true }),
      );

      await authService.refreshToken('incoming-refresh-token');

      expect(mockJwtService.verify).toHaveBeenCalledWith('incoming-refresh-token', {
        secret: 'refresh-only-secret',
      });

      process.env.JWT_REFRESH_SECRET = prevRefresh;
      process.env.JWT_SECRET = prevSecret;
    });

    it('should return new tokens and create a session on valid refresh', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({ id: 'user-1', isActive: true }),
      );

      const result = await authService.refreshToken('valid-refresh', '10.0.0.1', 'Agent/2');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockSessionsService.createSession).toHaveBeenCalledWith(
        'user-1',
        'mock-token',
        '10.0.0.1',
        'Agent/2',
      );
    });

    it('should throw UnauthorizedException when verify fails', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid signature');
      });

      await expect(authService.refreshToken('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ──────────── login ────────────
  describe('login', () => {
    it('should throw UnauthorizedException for wrong email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(
        authService.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({
          id: 'user-1',
          email: 'test@example.com',
          passwordHash: hash,
          twoFactorEnabled: false,
          organization: { id: 'org-1' },
        }),
      );

      await expect(
        authService.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return requires2FA when 2FA is enabled', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({
          id: 'user-1',
          email: 'test@example.com',
          passwordHash: hash,
          twoFactorEnabled: true,
          organization: { id: 'org-1' },
        }),
      );

      const result = await authService.login({ email: 'test@example.com', password: 'password123' });

      expect(result).toEqual({ requires2FA: true, userId: 'user-1' });
    });

    it('should return tokens on successful login', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test',
          role: 'owner',
          organizationId: 'org-1',
          passwordHash: hash,
          twoFactorEnabled: false,
          organization: { id: 'org-1', name: 'TestOrg' },
        }),
      );
      vi.mocked(prisma.user.update).mockResolvedValueOnce(userStub({ id: 'user-1' }));

      const result = await authService.login({ email: 'test@example.com', password: 'password123' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockSessionsService.createSession).toHaveBeenCalledOnce();
    });
  });

  // ──────────── changePassword ────────────
  describe('changePassword', () => {
    it('should throw BadRequestException for wrong current password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({ id: 'user-1', passwordHash: hash }),
      );

      await expect(
        authService.changePassword('user-1', 'wrongpassword', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for short new password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({ id: 'user-1', passwordHash: hash }),
      );

      await expect(
        authService.changePassword('user-1', 'oldpassword', 'short'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully change password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        userStub({ id: 'user-1', passwordHash: hash }),
      );
      vi.mocked(prisma.user.update).mockResolvedValueOnce(userStub({ id: 'user-1' }));

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
        ...userStub({
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test',
          passwordHash: 'secret',
          twoFactorSecret: 'secret',
          twoFactorEnabled: false,
          backupCodes: [],
        }),
        organization: { id: 'org-1', name: 'Org', slug: 'org', createdAt: new Date(), updatedAt: new Date(), settings: {} },
      });

      const profile = await authService.getProfile('user-1');

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('twoFactorSecret');
      expect(profile).toHaveProperty('email', 'test@example.com');
    });
  });
});